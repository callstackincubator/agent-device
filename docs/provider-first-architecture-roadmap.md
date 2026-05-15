# Provider-First Architecture Roadmap

This tracks the remaining architecture work after ADR 0001. The aim is to keep the Provider-first Device Lab architecture deep: broad command workflows should run through the real daemon path, Provider seams should stay below Platform modules, and unit tests should remain focused on parser, state-machine, selector, capability, and error behavior.

`ensure-simulator` has been removed on `main`; this roadmap no longer needs to protect or cover that lifecycle command.

## Milestones

Status meanings:

- `Done`: implemented and verified on this branch.
- `Watch`: no new abstraction is justified yet; keep measuring pressure before changing code.
- `Active`: current implementation lane.
- `Queued`: intentionally not started yet.

| # | Milestone | Status | Done means |
| ---: | --- | --- | --- |
| 1 | macOS helper permission and alert coverage | Done | Device Lab covers helper-backed permission grant/reset and alert get/accept/dismiss through the daemon request path. Redundant mocked happy-path units are removed when they no longer protect edge behavior. |
| 2 | Device Lab scenario world modules | Done | Repeated scripted device worlds move behind small test modules so scenarios read as workflows, not fixture construction. |
| 3 | Recording lifecycle locality | Done | Record/trace start-stop success paths are owned by Device Lab; unit tests focus on lifecycle edge cases, cleanup, telemetry, overlay, and fallback state machines. |
| 4 | Provider registry applicability | Done | Adding a Provider requires localized registration of applicability, resolution, and scope application instead of edits across several parallel type/function lists. |
| 5 | Apple tool semantic pressure | Watch | Generic Apple tool scripting is reduced only where Device Lab or a second Adapter proves a stable semantic Provider operation. |
| 6 | Snapshot unit-test split and deletion | Active | Snapshot handler unit tests are grouped by retained reason, and broad success paths covered by Device Lab are deleted. |
| 7 | Progress metrics quality dimensions | Done | Progress reporting includes command-family ownership, mock-heavy handler tests by family, and raw Provider transcript usage by platform. |
| 8 | Screenshot flag plumbing locality | Done | Screenshot-specific flag translation is owned by one codec module and broad screenshot behavior is covered through Device Lab instead of repeated hand-plumbing assertions. |

## Current Checkpoint

We are in milestone 6. Milestones 1-4, 7, and 8 are implemented. Milestone 5 is deliberately a watch item: the metrics show Apple raw tool/helper pressure, but the current repeated intent is still the macOS helper contract and does not justify another semantic Provider yet.

Milestone 6 progress:

- Done: deleted the macOS alert `get` happy-path unit after Device Lab covered alert get/accept/dismiss through the daemon path.
- Done: moved macOS desktop scoped snapshot coverage into Device Lab and deleted the narrower handler mock.
- Done: deleted the macOS `open --surface frontmost-app` happy-path unit after Device Lab covered the frontmost-app session state and helper provider call.
- Done: deleted the macOS menubar coordinate `click` routing unit after Device Lab covered the helper-backed press path.
- Done: moved untargeted and targeted macOS menubar snapshot coverage into Device Lab and deleted the two handler helper mocks.
- Done: after PR #553, centralized screenshot flag/request/runtime/script translation in `capture-screenshot-options.ts` and covered Android `stabilize: false` through Device Lab.
- Done: moved macOS desktop `wait` helper-backed snapshot polling into Device Lab and deleted the narrower mocked handler success test.
- Done: deepened Android Device Lab perf assertions to cover memory, CPU, FPS, and ADB provider calls; deleted redundant perf provider-routing and Android perf happy-path unit tests.
- Done: moved diff baseline initialization coverage into Android Device Lab and deleted the mocked handler baseline success test; runtime diff units retain pure diff semantics.
- Done: moved explicit-selector `trigger-app-event` and cwd-relative `push` payload-file success paths into Android Device Lab; deleted the mocked handler success units and simplified `session-push.test.ts` to the remaining admission edge.
- Done: deepened Android Device Lab network assertions to parse headers and request/response bodies from the live app-log stream; deleted the mocked handler parsed-network-entry success test.
- Still retained: Android freshness/collapse warnings, macOS menubar interaction guard/ref-promotion edges, wait routing, alert retry/error policy, diff invalid-kind/client-backed boundaries, recording touch visualization, off-screen failures, and pure snapshot state/visibility shaping.
- Next checkpoint: continue only where Device Lab can cover a plain success workflow; otherwise move to the next mock-heavy file from the progress report and leave edge/state-machine tests in unit coverage.

## Current Assessment

- Provider placement remains sound: Device Lab replaces platform Providers below handlers and dispatch, so request admission, locking, session state, command routing, platform translation, and provider contracts stay under test.
- Scenario worlds are useful when they remove fixture noise from workflow tests. They should stay thin and platform-specific; they must not become an alternate framework above the daemon request path.
- Apple raw tool/helper pressure is visible but not yet a mandate for more semantic sub-providers. The macOS helper calls are still one host-helper contract, while iOS simulator/device operations already have semantic `simctl` and `devicectl` runners.
- The screenshot flag pass is a useful architecture check. The remaining unavoidable places for a new screenshot-specific flag should be the screenshot flag codec, the platform/backend implementation when behavior changes, and focused tests. The codec owns internal flag types, CLI flag metadata, request/runtime conversion, replay parsing/formatting, and recorded action keys. CLI command handlers, typed client forwarding, daemon context creation, runtime screenshot dispatch, action recording, and replay script formatting should not each learn the flag independently.
- Snapshot unit deletion should remain conservative. The safe deletions so far were macOS alert, desktop scoped snapshot, and menubar snapshot happy paths now covered by Device Lab. The remaining snapshot units mostly protect freshness, scoped refs, retry behavior, and snapshot shaping.

## Operating Rules

- Use Device Lab for command workflows and Provider contracts.
- Keep HTTP contract tests narrow and transport-specific.
- Keep unit tests for pure logic, parser matrices, selector matching, capabilities, state machines, malformed inputs, and cleanup/error behavior.
- Promote semantic Provider operations only when the current generic Provider interface forces tests or Adapters to recover intent from raw host commands.
- After each milestone, do a zoom-out self-review before moving to the next one.
