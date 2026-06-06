# iOS Simulator AX snapshot fallback — research and recommendation

Research input for [#701](https://github.com/callstack/agent-device/issues/701) ("Add iOS Simulator AX
snapshot fallback for XCTest snapshot failures"). This note evaluates whether a non-XCTest
accessibility backend is the right path for the simulator-only failure class, surveys how `idb`,
Appium/WebDriverAgent, Maestro, and newer simulator tools solve it, and answers the three product
questions raised: is this the path forward, will we sometimes have to accept that snapshots fail with
no fallback, and should the alternate mechanism become the simulator default.

## Verdict (short version)

- **Yes, a simulator-only AX fallback is the right direction**, exactly in the bounded, opt-in shape
  the issue proposes. It should sit *beside* XCTest, not replace it.
- **No, it should not be the simulator default.** XCTest must stay the default read path because it is
  the same engine that resolves *actions*. Splitting reads onto a different backend than actions
  introduces ref/selector incoherence (see "The coherence constraint" below). Default-on would
  regress the common case to fix the rare one.
- **Yes, we will still sometimes have to accept failure.** Physical devices have no host-side AX
  channel at all, and even on the simulator the alternate backend has its *own* coverage holes
  (notably tab bars on recent Xcode) and lower-confidence geometry. The honest-fast XCTest behavior
  must remain; the fallback is additive and must be labeled degraded, never silent.

## 1. The problem is intrinsic to `XCUIElement.snapshot()`, not to our usage

The failure modes in the issue — `kAXErrorIllegalArgument`, compact-interactive output collapsing to
the synthetic application root, and retries getting slower instead of recovering — are properties of
XCTest's accessibility serialization, not of how `agent-device` drives it.

- XCTest hard-caps element-tree traversal at **depth 60**; anything deeper is bundled into a single
  element, and very deep/wide trees (classic deeply-nested React Navigation stacks) can fail
  serialization outright with `kAXErrorIllegalArgument`. This is the same wall Appium users hit, and
  the only XCTest-level levers are `snapshotMaxDepth` / `customSnapshotTimeout` — which have
  themselves regressed across XCUITest-driver versions.
- **Appium's WebDriverAgent uses the same `XCUIApplication().snapshot()` under the hood**, so it
  reproduces the identical `kAXErrorIllegalArgument` / stuck `getPageSource` failures. Appium is not a
  separate mechanism; it confirms the ceiling is XCTest itself.

References:
[appium/appium#15585 (kAXErrorIllegalArgument)](https://github.com/appium/appium/issues/15585),
[appium/appium#14825 (deep React Navigation on iOS)](https://github.com/appium/appium/issues/14825),
[appium/appium#18085 (snapshotMaxDepth ignored)](https://github.com/appium/appium/issues/18085),
[Appium XCUITest settings reference](https://appium.github.io/appium-xcuitest-driver/9.9/reference/settings/).

Implication: there is no XCTest-side tuning that reliably recovers this class. Regaining semantic
coverage requires a *different backend*, which is what #701 asks for.

## 2. Current `agent-device` behavior (the baseline we must preserve)

The Swift runner already handles this honestly:

- `RunnerTests+Snapshot.swift` catches the snapshot throw, detects the illegal-argument signature
  (`isAxIllegalArgument`), and raises a structured `IOS_AX_SNAPSHOT_FAILED` failure with an actionable
  hint (try a scoped read, use direct `find id … click`, fall back to screenshot/logs, or simplify the
  tree). It also has a targeted *collapsed tab bar* fallback that scans descendants when XCTest omits
  tab children from the tree — i.e. we already know XCTest under-reports tab bars.
- TS side: `IOS_AX_SNAPSHOT_FAILED` is non-retryable (`runner-contract.ts` /
  `runner-client.test.ts`), so we fail fast rather than burning the command budget on doomed retries.
- The snapshot data model (`src/utils/snapshot.ts`) already carries a `SnapshotBackend` union
  (`'xctest' | 'android' | 'macos-helper' | 'linux-atspi'`) and per-node `RawSnapshotNode` fields
  (`role`, `subrole`, `identifier`, `selected`, `hittable`, `pid`, `bundleId`, …). Adding an
  `'ios-simulator-ax'` backend value is a natural extension.

This baseline is correct and must not regress. The fallback is for *recovering coverage*, not for
masking that XCTest failed.

## 3. Candidate fallback mechanisms

There are two genuinely different "host-side" ways to read a simulator's accessibility surface without
`XCUIElement.snapshot()`. The issue's phrase "similar in role to idb" actually spans both; they have
very different risk profiles.

### Mechanism A — Public macOS Accessibility API over `Simulator.app` (recommended first)

The iOS Simulator renders into a host macOS window, and CoreSimulator's accessibility translation
("AXPTranslator") bridges the simulated app's `UIAccessibility` tree into host-consumable
`AXUIElement` nodes. This is exactly what **Xcode's Accessibility Inspector** consumes when pointed at
a simulator, and what the open-source CLI **[`xctree`](https://github.com/ldomaradzki/xctree)**
replicates: it "uses the public macOS Accessibility API," targets the Simulator process, is
**simulator-only**, and requires macOS 15+ plus Accessibility permission.

Why this is attractive for us specifically:

- **We already have ~90% of the implementation.** `macos-helper/Sources/AgentDeviceMacOSHelper/SnapshotTraversal.swift`
  is a complete, bounded `AXUIElement` walker (`AXUIElementCreateApplication(pid)` → windows →
  children, with `maxNodes`/`maxDepth`/visited-cycle guards) that already emits a
  `SnapshotNodeResponse` shape compatible with `RawSnapshotNode` and is wired through
  `runMacOsSnapshotAction` with `backend: 'macos-helper'`. A simulator AX backend is largely "point the
  existing traversal at the Simulator process + normalize coordinates."
- **No private frameworks**, so it survives Xcode upgrades far better than `idb` (see Mechanism B).
- Aligns with ADR-0002 (persistent platform helper sessions) and the existing helper build pipeline
  (`pnpm build:macos-helper`, fingerprint-cached install).

Known limits (must be validated, not assumed):

- Public host AX **does not expose every iOS element**. `xctree` explicitly notes "some iOS UI
  elements may not be exposed (e.g., tab bar buttons in Xcode 26)" — the *same* gap class our XCTest
  collapsed-tab fallback already compensates for. So Mechanism A may recover deep content trees while
  still missing the exact controls XCTest also struggles with. Net coverage on the target failure
  screens is an empirical question.
- **Coordinate space:** host AX returns screen/window points for the Simulator window (with chrome,
  device bezel, and display scaling). These must be normalized back into simulated-device points so
  refs stay tappable by the XCTest action path. This is the main correctness risk and the bulk of new
  logic.
- Multiple Simulator windows / multiple booted devices require deterministic window→device→app-root
  selection (the issue calls this out).
- Requires the macOS Accessibility permission, which we already manage for the macOS helper.

### Mechanism B — Private CoreSimulator AX channel (the literal `idb` approach)

`idb`/`FBSimulatorControl` do **not** use host `AXUIElement`. They link the private `CoreSimulator`
framework and call `SimDevice.sendAccessibilityRequestAsync` (AXPTranslatorRequest/Response) to get a
**flat list** of every AX element with frames in device coordinates. Newer tools like
**[`AXe`](https://github.com/cameroncooke/AXe)** use the same "Apple private accessibility APIs"
surface.

Trade-offs:

- **Most complete** when it works — a single call returns the whole flat node set in device points, no
  host-window coordinate translation, and it does not inherit XCTest's depth-60 ceiling.
- **Fragile across OS/Xcode versions.** This is the decisive risk and it is well-documented:
  - **Maestro deliberately migrated *off* `idb*` to an in-test XCUITest HTTP server** precisely because
    `idb`'s private APIs broke (gRPC errors / empty accessibility on iOS 16) and were "fragile to iOS
    version updates," and because they found XCUITest output richer.
    ([Maestro — Re-Building the iOS Driver](https://maestro.dev/blog/maestro-re-building-the-ios-driver))
  - **`idb` broke on iOS 17** when Apple changed simulator developer-function access
    ([facebook/idb#853](https://github.com/facebook/idb/issues/853)).
  - `idb ui describe-all` also under-reports elements nested under `type=Group`/`role_description=group`
    ([facebook/idb#767](https://github.com/facebook/idb/issues/767)).
- Productizing it means either shelling out to an external `idb` install (heavy, version-coupled
  dependency we don't otherwise need) or vendoring a thin compiled helper that links private
  CoreSimulator SPI (a maintenance liability that must be re-validated every Xcode release).

### What the industry signal tells us

The most important external data point: **Maestro, the closest analog, ran *toward* XCTest and *away*
from idb.** That argues strongly against making `idb`-style private AX our primary or default path. But
note Maestro's replacement still ultimately calls `XCUIApplication().snapshot()` inside its FlyingFox
server, so **Maestro would still hit the same deep-tree failure** — they traded fragility for richness,
not for immunity to the depth ceiling. That is the gap #701 is trying to close, and it is why a
*public-AX* fallback (Mechanism A), which is a genuinely different engine, is more interesting than
re-implementing Maestro's XCTest server.

## 4. The coherence constraint (why fallback-only, not default)

`agent-device`'s value is that a snapshot ref like `@e3` is *immediately actionable*. On iOS, **actions
always go through the XCTest runner** (`runIosRunnerCommand` → `tap`/`type`/`querySelector` resolved by
XCUITest selectors on `id`/`label`/`value`). If reads come from a different backend than actions:

- A node the AX backend surfaces may not resolve to any `XCUIElement` the action path can find (host AX
  `AXIdentifier` ↔ XCUITest `identifier` usually align, but label/value normalization and
  hit-testing differ).
- Hittability and geometry from host AX are computed differently than XCTest's real hit-testing, so a
  ref can look tappable in the snapshot but miss at action time.

This is why the fallback must be **gated on the XCTest read actually failing** (or degrading to
root-only), **simulator-only**, and **labeled degraded/low-confidence**, with `backend:
'ios-simulator-ax'` visible in diagnostics and snapshot warnings. Making it the default would route the
*common* case through a read engine that doesn't match the action engine — a net regression. The
Maestro/idb history reinforces this: keep the proven engine in the hot path, add the alternate engine
only at the edge.

## 5. Recommended approach

1. **Adopt the fallback, scoped exactly as #701 states:** simulator-only; XCTest stays default for
   actions, physical devices, and working snapshots; the AX backend triggers only on
   `IOS_AX_SNAPSHOT_FAILED` or sparse/root-only compact-interactive output.
2. **Build it as Mechanism A first** (public AX over `Simulator.app`), reusing
   `macos-helper`'s `SnapshotTraversal.swift` rather than taking an `idb` dependency. Add an
   `ios-simulator-ax` surface/command to the helper, deterministic Simulator-window/device/app-root
   selection, bounded traversal with per-node failure tolerance, and **device-coordinate
   normalization**. Reuse the ADR-0002 helper-session lifecycle and the existing fingerprint build.
3. **Spike-validate coverage before committing UX.** The open question is whether host public AX
   actually recovers the target screens (deep React Navigation) *and* whether it still misses the same
   controls XCTest misses (tab bars on Xcode 26). Run the issue's validation set (Settings, React
   Navigation example, a known-failing repro, modals/keyboard/scroll, multi-window) through the spike
   and compare node coverage + ref actionability against XCTest. If Mechanism A leaves the *actionable*
   gaps unfilled, reconsider a narrowly-vendored Mechanism B helper as a second tier — accepting its
   version-pinning cost — rather than defaulting to it.
4. **Wire the fallback at the iOS capture seam, not in the daemon core.** The snapshot path is
   `dispatchSnapshotViaRuntime` → `captureSnapshot` / `captureSnapshotData`
   (`src/daemon/handlers/snapshot-capture.ts`) → iOS interactor `snapshot` →
   `runIosRunnerCommand`. The clean hook is: when the iOS runner snapshot throws
   `IOS_AX_SNAPSHOT_FAILED` (or returns root-only on a `kind: 'simulator'` device), invoke the new AX
   backend and return `{ nodes, truncated, backend: 'ios-simulator-ax', degraded: true }`. Extend the
   `SnapshotBackend` union and let `buildSnapshotState` tag/labels flow through, mirroring how
   `macos-helper` and `android-helper` backends already propagate metadata.
5. **Keep diagnostics honest.** Emit a diagnostic for: XCTest failed → AX fallback attempted → AX
   succeeded/failed, with backend and degraded confidence. No silent substitution. On physical devices,
   keep the current `IOS_AX_SNAPSHOT_FAILED` + hint with *no* fallback.

## 6. Answers to the three questions in the brief

- **Is this the path forward?** Yes — a separate, simulator-only AX backend is the only way to regain
  semantic coverage for the XCTest-serialization failure class, and the repo already has the building
  blocks. Prefer public-AX (Mechanism A) over `idb`-style private AX (Mechanism B) for durability.
- **Will we sometimes have to accept that snapshots fail with no fallback?** Yes, and that is correct:
  (a) physical devices have no host AX bridge; (b) even on the simulator the fallback is degraded and
  has its own gaps (tab bars, coordinate confidence, group-nested elements for the idb variant); (c)
  for genuinely pathological trees we may only recover a flatter/partial view. The honest-fast XCTest
  failure with a good hint stays the floor.
- **Default on simulator?** No. Keep XCTest as the default read engine because it is the action engine;
  route to the AX backend only on failure/sparse output, and label it degraded. Default-on trades the
  common case for the rare case and breaks ref↔action coherence.

## 7. Risks and open validation items

- **Coverage uncertainty (highest):** does public host AX expose the deep React Navigation content that
  XCTest can't serialize, and does it still miss tab bars? Must be measured on real screens.
- **Coordinate normalization:** host-window → device-point mapping across device bezel, window chrome,
  Retina scaling, rotation, and multiple displays. Get this wrong and refs become non-tappable.
- **Ref/selector coherence:** verify AX-surfaced `identifier`/`label` resolve via the XCTest action
  path; otherwise refs are inspect-only and should be marked as such.
- **Multi-window / multi-device determinism** and **Accessibility permission** UX.
- **If Mechanism B is ever needed:** pin Xcode/iOS versions, treat as best-effort, and budget for
  per-Xcode re-validation (the lesson from idb#853 and Maestro's migration).

## Sources

- [Maestro — Re-Building the iOS Driver](https://maestro.dev/blog/maestro-re-building-the-ios-driver)
  (migration off idb to an XCUITest HTTP server; idb fragility on iOS 16)
- [facebook/idb#853 — iOS 17 support](https://github.com/facebook/idb/issues/853)
- [facebook/idb#767 — describe-all misses group-nested elements](https://github.com/facebook/idb/issues/767)
- [idb Accessibility Automation docs](https://fbidb.io/docs/accessibility/),
  [idb FBSimulatorControl / CoreSimulator architecture](https://fbidb.io/docs/fbsimulatorcontrol/)
- [appium/appium#15585](https://github.com/appium/appium/issues/15585),
  [#14825](https://github.com/appium/appium/issues/14825),
  [#18085](https://github.com/appium/appium/issues/18085),
  [Appium XCUITest settings](https://appium.github.io/appium-xcuitest-driver/9.9/reference/settings/)
  (WebDriverAgent shares XCUITest's snapshot ceiling)
- [`xctree`](https://github.com/ldomaradzki/xctree) (public macOS AX over Simulator, simulator-only,
  notes tab-bar gaps on Xcode 26) and [author write-up](https://ldomaradzki.com/blog/xctree-accessibility-cli)
- [`AXe`](https://github.com/cameroncooke/AXe) (simulator control via Apple private accessibility APIs)
</content>
</invoke>
