# Device Lab Testing Progress

This is the working guide for the provider-first Device Lab migration. The ADR records the architecture decision; this document tracks progress, deletion rules, and the next useful work.

## Goal

Move broad command coverage from mock-heavy handler unit tests into Device Lab integration scenarios that run through request admission, locking, session state, handlers, dispatch, platform modules, and request-scoped providers without requiring real devices.

## Progress Measures

Run:

```sh
pnpm test:device-lab:progress
```

Current local snapshot:

| Measure | Value |
| --- | ---: |
| Handler unit test files | 29 |
| Handler unit test LOC | 13225 |
| Handler unit tests | 349 |
| Handler files with `vi.mock` | 17 |
| Device Lab files | 12 |
| Device Lab LOC | 3012 |
| Device Lab tests | 15 |
| Device Lab support files | 7 |
| Device Lab support LOC | 736 |
| Device Lab / handler LOC | 22.8% |

Coverage is tracked separately by:

```sh
pnpm test:coverage:check
```

Current local coverage: 78.66% statements, 68.69% branches, 86.27% functions, 80.66% lines.

Gates:

- Statement regression floor: 78%.
- Line regression floor: 80%.
- Near-term statement target: 80%.

Do not raise floors by adding tests that only execute code. Added coverage must assert user-visible behavior, provider contracts, parser contracts, or important edge/error handling.

The progress script also prints the largest mock-heavy handler test files and Provider transcript pressure by contract surface. Use those tables to pick deletion candidates and to decide when raw provider scripting has enough repeated intent to justify a semantic Provider method.

## Coverage Accounting

Not every red file should become a Device Lab target:

- `src/daemon.ts`, `src/daemon/transport.ts`, and `src/daemon/server-lifecycle.ts` are entrypoint/transport lifecycle code. Cover them with smoke or packaging tests, not command-scenario Device Lab tests.
- `src/client-companion-tunnel-worker.ts` is subprocess code. Existing worker tests exercise real child-process behavior, but V8 coverage attribution is weak. Do not replace those with in-process tests unless the contract itself moves in-process.
- `src/daemon/http-server.ts` is covered by HTTP smoke tests. Device Lab scenarios should keep using the in-process request-handler harness except for one transport wiring smoke test.
- Removed lifecycle commands should stay out of the Device Lab matrix. The `ensure-simulator` cleanup landed on `main`, which validates the decision to avoid adding coverage for command surface we intended to delete.

Use Device Lab for command workflows and provider contracts. Use focused unit/protocol tests for parsers, state machines, subprocess lifecycle, transport entrypoints, and malformed inputs.

## Coverage Leverage Backlog

Latest `pnpm test:coverage` snapshot shows the biggest low-coverage implementation files:

| File | Coverage | Missing statements | Device Lab fit | Real scenario to add |
| --- | ---: | ---: | --- | --- |
| `src/daemon-client.ts` | 44.38% | 272 | Partial | Keep one transport smoke flow; do not duplicate every client startup branch in Device Lab. Prefer direct request-handler tests for provider behavior and a small CLI/daemon smoke check for daemon discovery. |
| `src/client-companion-tunnel-worker.ts` | 1.11% | 266 | Poor | Existing child-process tests cover real tunnel behavior but V8 does not attribute subprocess execution here. Do not chase this with synthetic coverage; improve subprocess coverage separately if needed. |
| `src/daemon/http-server.ts` | 56.13% | 118 | Partial | Existing HTTP smoke tests cover lease/auth/upload paths, but they are outside the coverage command. Keep one HTTP transport integration path; Device Lab should invoke the request handler directly for command/provider behavior. |
| `src/platforms/ios/runner-session.ts` | 27.94% | 98 | Medium | Protocol-level session tests now cover read-only execution, mutating readiness probes, and structured runner failures. Keep deeper xcodebuild startup/cleanup as focused state-machine tests. |
| `src/daemon.ts` | 0% | 89 | Poor | Entrypoint wiring belongs in one smoke/packaging test, not Device Lab. |
| `src/platforms/android/manifest.ts` | 35.16% | 83 | Medium | APK manifest install is covered through Device Lab. Keep AAB/binary/malformed manifest coverage as parser/platform units because bundletool and binary XML are not Device Lab concerns. |
| `src/daemon/transport.ts` | 0% | 80 | Poor | Transport selection is better covered by CLI/client smoke tests than command Device Lab tests. |
| `src/daemon/handlers/find.ts` | 43.47% | 78 | Good | Android Device Lab now covers broad `find` behavior: snapshot refs, get attrs/text, type, wait, invalid `--first`/`--last`, ambiguous matches, first/last selection, and follow-up interaction using a found ref. Next coverage should target remaining edge behavior only. |
| `src/platforms/ios/macos-helper.ts` | 46.03% | 68 | Good | macOS Device Lab now covers permission grant/reset and alert get/accept/dismiss through helper-backed provider calls. Next coverage should target helper errors or install/diagnostic paths only if they are product-critical. |
| Removed lifecycle commands | n/a | n/a | Omit | Do not add Device Lab scenarios for command surface already accepted for deletion. The removed `ensure-simulator` command is the precedent. |

Priority order:

1. Continue reducing `session.test.ts`, `interaction.test.ts`, `snapshot-handler.test.ts`, and `record-trace.test.ts` only where Device Lab already proves the same successful workflow through provider seams.
2. Coverage accounting: avoid synthetic tests for subprocess and entrypoint files; document or measure those through smoke/packaging tests instead.
3. Android manifest follow-up only if AAB install becomes provider-backed; until then keep AAB parser coverage as unit tests.
4. Runner startup cleanup follow-up only when we can model xcodebuild lifecycle without hard-coding implementation order.
5. Reassess Apple raw tool/helper provider pressure when another Adapter would need to recover stable intent from host commands.

## Public Command Coverage Ledger

Every command in `PUBLIC_COMMANDS` now has at least one Device Lab scenario running through the request router and provider seams. Unit tests remain for malformed input, parsers, capability tables, retry state machines, and platform edge cases.

| Command | Device Lab owner |
| --- | --- |
| `alert` | iOS alert/settings, macOS desktop |
| `appstate` | Android lifecycle, iOS lifecycle, macOS desktop |
| `app-switcher` | Android lifecycle |
| `apps` | Android lifecycle, iOS lifecycle, macOS desktop |
| `back` | Linux desktop, tvOS remote |
| `batch` | Android lifecycle |
| `boot` | Android lifecycle |
| `click` | Android lifecycle, Linux desktop, macOS desktop |
| `close` | Android lifecycle, iOS lifecycle, Linux desktop, macOS desktop, tvOS remote |
| `clipboard` | Android lifecycle, iOS lifecycle, Linux desktop, macOS desktop |
| `devices` | Android lifecycle through injected inventory provider |
| `diff` | Android lifecycle |
| `fill` | Android lifecycle, Linux desktop |
| `find` | Android find matrix, iOS lifecycle |
| `focus` | Linux desktop |
| `get` | Android lifecycle/find matrix, iOS lifecycle, macOS desktop |
| `home` | Linux desktop, tvOS remote |
| `install` | iOS lifecycle |
| `install-from-source` | Android lifecycle |
| `is` | Android lifecycle/find matrix, iOS lifecycle |
| `keyboard` | Android lifecycle, iOS lifecycle |
| `logs` | Android lifecycle, iOS alert/settings, macOS desktop |
| `longpress` | Linux desktop |
| `network` | Android lifecycle |
| `open` | Android lifecycle, iOS lifecycle, Linux desktop, macOS desktop, tvOS remote |
| `perf` | Android lifecycle |
| `pinch` | iOS lifecycle |
| `press` | Android lifecycle, iOS lifecycle, Linux desktop, macOS desktop |
| `push` | Android lifecycle |
| `record` | Android recording, iOS record/trace, macOS recording |
| `reinstall` | Android lifecycle, iOS lifecycle, iOS physical reinstall |
| `replay` | Android lifecycle |
| `rotate` | Android lifecycle |
| `scroll` | Linux desktop, tvOS remote |
| `screenshot` | Android lifecycle, Linux desktop |
| `settings` | Android lifecycle, iOS alert/settings, macOS desktop |
| `snapshot` | Android lifecycle, iOS lifecycle, Linux desktop, macOS desktop, tvOS remote |
| `swipe` | Linux desktop |
| `test` | Android lifecycle |
| `trace` | iOS record/trace |
| `trigger-app-event` | Android lifecycle |
| `type` | Linux desktop |
| `wait` | Android lifecycle/find matrix, iOS lifecycle |

## Command Matrix

| Command family | Device Lab coverage | Keep unit coverage for | Next action |
| --- | --- | --- | --- |
| `devices`, `boot`, `open`, `close`, `session_list`, `appstate` | Android inventory, explicit-selector boot, and session-backed boot through injected providers; Android lifecycle, active/closed iOS session listing, tvOS remote, macOS app/frontmost/desktop surfaces, Linux desktop | invalid open args, host discovery parser failures, session conflict/lock behavior, runtime hint edge cases, close shutdown edge cases, scoped simulator set field shaping | Keep remaining session units unless they assert a plain success path with no policy or field-shaping edge. |
| `apps` | Android, iOS, macOS default and `--apps-filter all` flows | parser/default normalization, typed client flag forwarding, platform-specific app parser edge cases | Broad Device Lab and parser/client coverage are in place; no handler-level list happy path remains to delete. |
| `install`, `reinstall` | Android reinstall, Android install-from-source APK manifest identity, iOS simulator install/reinstall, iOS device reinstall | archive/materialization parsing, invalid install source, platform-specific failure mapping, AAB/binary manifest parser edge cases | Keep install-source units that prove error/fallback behavior; delete daemon happy-path deploy duplicates. |
| `push` | Android lifecycle broadcast payload with extras, relative payload files, and brace-prefixed payload files resolved from request cwd | payload parsing and unsupported platform errors | Keep the active-session-or-selector admission unit and core payload parser tests. |
| `snapshot`, `diff`, `screenshot` | Android snapshot/diff/screenshot and provider failure normalization, Android no-stabilize screenshot path, iOS snapshot, macOS frontmost, desktop, untargeted menubar, and targeted menubar surface snapshots, Linux snapshot/screenshot, scoped Linux `@ref`/depth snapshots | snapshot processing, selector pruning, screenshot scaling/format edge cases, Android freshness retries, macOS scoped edge cases | Delete only broad snapshot handler duplicates; keep narrow processing and freshness units. |
| `press`, `click`, `focus`, `longpress`, `swipe`, `scroll`, `type`, `pinch`, `rotate`, `app-switcher` | Android press/click/fill/rotate/app-switcher; iOS press/pinch; tvOS remote scroll/back/home; macOS press; Linux pointer, click buttons, swipe, scroll, type, and session action recording | selector resolution edge cases, platform-specific coordinate translation, unsupported gesture/platform failures, invalid flag combinations | Remaining interaction units mostly protect edge behavior; delete only newly duplicated plain successes. |
| `fill`, `get`, `is`, `find`, `wait` | Android fill/get/is/find/wait plus dedicated Android `find` scenario for refs, get attrs/text, type, wait, invalid first/last flags, ambiguous matches, and first/last selection; iOS get/is/find/wait; macOS helper-backed `get text @ref` read expansion | selector parser/matcher matrices, replay healing, ambiguous selector/error behavior, fallback text extraction, Android IME ownership edge cases | Keep selector/IME units; delete handler-level success duplicates. |
| `clipboard` | Android read/write, iOS read/write, macOS read/write, Linux read/write | physical-device unsupported cases and platform output parsing edge cases | Remaining happy-path clipboard unit tests should be rare deletion candidates. |
| `keyboard` | Android status/dismiss, iOS dismiss | keyboard state parsing, duplicate dumpsys fields, unsupported dismiss flows | Keep Android keyboard parser/dismiss edge tests. |
| `settings` | Android appearance/location/fingerprint/permission/animations; iOS appearance/location/permission; macOS appearance | invalid states, permission target mapping, location coordinate parsing, biometric fallbacks | Delete handler dispatch-shape duplicates only after platform/provider assertions cover the command. |
| `record`, `trace` | Android recording start/stop/pull; iOS simulator recording start/stop; iOS device recording and trace start/stop; macOS recording start/stop | telemetry timing, overlay generation, failure cleanup, artifact finalization | Device Lab owns broad successful lifecycle coverage; keep unit coverage for cleanup, telemetry, and failure state. |
| `logs`, `network`, `perf` | iOS logs path/start/stop/mark/doctor, macOS logs path, Android logs doctor/start/stop/clear/restart, Android close auto-stopping active logs, Android network dump with parsed headers/body from a restarted live app-log stream, Android perf sampling response | process lifecycle edge cases, tail/grep contracts, network parser/recovery notes, unavailable backend errors, clear/restart failure cleanup | Keep backend unit tests; delete handler orchestration happy paths covered by Device Lab. |
| `batch`, `replay`, `test` | Android batch, replay through a script, and replay test suite execution through provider-backed Android commands | replay parser vars/env, healing, failure attribution, artifact materialization failures | Keep replay parser/healing units; delete simple replay execution happy paths only. |
| `trigger-app-event` | Android lifecycle deep-link event dispatch with encoded payload and provider assertion | template resolution, invalid payloads, URL length limits, platform-specific template precedence | Keep app-event parser/validation units; delete dispatch happy-path duplicates only after checking edge coverage. |

## Unit Retention Rules

Keep unit tests for:

- CLI codecs, positional parsing, flag normalization, typed client option mapping, and public schema stability.
- Selector parsing, matching, visibility semantics, `is` predicates, and replay healing.
- Capability maps, target/device resolution, invalid command shapes, and gesture math.
- Admission, locking, cancellation, leases, session persistence, runtime hints, and artifact tracking.
- Snapshot processing, node shaping, pruning, scoped refs, hidden-content hints, output formatting, and diffing.
- Platform parsers, retry/fallback state machines, provider scope routing, and unsupported-device failures.
- Recording timing, overlay events, stream cleanup, network log parsing, and recovery notes.

Delete or avoid adding unit tests that:

- mock `dispatchCommand`, `ensureDeviceReady`, or platform modules only to assert successful pass-through;
- duplicate a Device Lab provider transcript without exercising an edge case;
- assert command list/order when order is not user-visible behavior;
- restate shapes TypeScript already guarantees.

Before deleting a unit test, confirm that a Device Lab scenario covers the successful user workflow through the request router and provider seam, and that the unit test is not the only parser, selector, capability, state-machine, cleanup, or error assertion.

## Next Work

1. Continue the mock-heavy handler audit only when Device Lab already owns the equivalent workflow. The latest pass moved Android logs clear --restart and session-backed boot coverage into Device Lab, after moving logs clear/close auto-stop in the previous pass.
2. Review the top mock-heavy files from `pnpm test:device-lab:progress` before adding new handler unit coverage. Prefer a Device Lab scenario when the behavior is a command workflow.
3. Reassess Apple raw tool/helper provider pressure when another Adapter or another scenario has to pattern-match the same host command intent.
4. Use PR #553 as the flag-plumbing baseline: the command-specific codec should be the normal edit path for screenshot-specific flags, with Device Lab proving the daemon/provider behavior.
