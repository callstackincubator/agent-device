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
| Handler unit test LOC | 13928 |
| Handler unit tests | 396 |
| Handler files with `vi.mock` | 18 |
| Device Lab files | 11 |
| Device Lab LOC | 2604 |
| Device Lab tests | 17 |
| Device Lab / handler LOC | 18.7% |

Coverage is tracked separately by:

```sh
pnpm test:coverage:check
```

Current local coverage: 78.62% statements, 68.72% branches, 86.27% functions, 80.62% lines.

Gates:

- Statement regression floor: 78%.
- Line regression floor: 80%.
- Near-term statement target: 80%.

Do not raise floors by adding tests that only execute code. Added coverage must assert user-visible behavior, provider contracts, parser contracts, or important edge/error handling.

## Coverage Accounting

Not every red file should become a Device Lab target:

- `src/daemon.ts`, `src/daemon/transport.ts`, and `src/daemon/server-lifecycle.ts` are entrypoint/transport lifecycle code. Cover them with smoke or packaging tests, not command-scenario Device Lab tests.
- `src/client-companion-tunnel-worker.ts` is subprocess code. Existing worker tests exercise real child-process behavior, but V8 coverage attribution is weak. Do not replace those with in-process tests unless the contract itself moves in-process.
- `src/daemon/http-server.ts` is covered by HTTP smoke tests. Device Lab scenarios should keep using the in-process request-handler harness except for one transport wiring smoke test.
- `src/platforms/ios/ensure-simulator.ts` is tracked for removal in issue #549. Do not add new coverage for command surface we intend to delete.

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
| `src/platforms/ios/macos-helper.ts` | 46.82% | 67 | Good | Add macOS helper-backed alert and permission scenarios that assert user-visible status and provider calls. |
| `src/platforms/ios/ensure-simulator.ts` | 0% | 61 | Omit | Track removal separately instead of adding coverage. The command was demo-driven lifecycle policy and should not anchor this provider refactor. See issue #549. |

Priority order:

1. macOS helper alert/permission Device Lab: covers desktop modality without real devices and exercises the helper seam.
2. Review `record-trace` success-path units now that simulator/device recording scenarios exist.
3. Coverage accounting: avoid synthetic tests for subprocess and entrypoint files; document or measure those through smoke/packaging tests instead.
4. Android manifest follow-up only if AAB install becomes provider-backed; until then keep AAB parser coverage as unit tests.
5. Runner startup cleanup follow-up only when we can model xcodebuild lifecycle without hard-coding implementation order.

## Command Matrix

| Command family | Device Lab coverage | Keep unit coverage for | Next action |
| --- | --- | --- | --- |
| `open`, `close`, `session_list`, `appstate` | Android lifecycle, active/closed iOS session listing, tvOS remote, macOS app/frontmost/desktop surfaces, Linux desktop | invalid open args, session conflict/lock behavior, runtime hint edge cases, close shutdown edge cases, scoped simulator set field shaping | Keep remaining session units unless they assert a plain success path with no policy or field-shaping edge. |
| `apps` | Android, iOS, macOS default and `--apps-filter all` flows | parser/default normalization, typed client flag forwarding, platform-specific app parser edge cases | Broad Device Lab and parser/client coverage are in place; no handler-level list happy path remains to delete. |
| `install`, `reinstall` | Android reinstall, Android install-from-source APK manifest identity, iOS simulator install/reinstall, iOS device reinstall | archive/materialization parsing, invalid install source, platform-specific failure mapping, AAB/binary manifest parser edge cases | Keep install-source units that prove error/fallback behavior; delete daemon happy-path deploy duplicates. |
| `push` | Android lifecycle broadcast payload with extras | payload parsing and unsupported platform errors | Delete narrow Android push happy-path handler tests; keep invalid payload tests. |
| `snapshot`, `screenshot` | Android snapshot/screenshot and provider failure normalization, iOS snapshot, macOS frontmost and desktop surface snapshots, Linux snapshot/screenshot, scoped Linux `@ref`/depth snapshots | snapshot processing, selector pruning, screenshot scaling/format edge cases, Android freshness retries, macOS scoped/menubar edge cases | Delete only broad snapshot handler duplicates; keep narrow processing and freshness units. |
| `press`, `click`, `focus`, `longpress`, `swipe`, `scroll`, `type` | Android press/click/fill; iOS press; tvOS remote scroll/back/home; macOS press; Linux pointer, click buttons, swipe, scroll, type, and session action recording | selector resolution edge cases, platform-specific coordinate translation, invalid flag combinations | Remaining interaction units mostly protect edge behavior; delete only newly duplicated plain successes. |
| `fill`, `get`, `is`, `find`, `wait` | Android fill/get/is/find/wait plus dedicated Android `find` scenario for refs, get attrs/text, type, wait, invalid first/last flags, ambiguous matches, and first/last selection; iOS get/is/find/wait; macOS helper-backed `get text @ref` read expansion | selector parser/matcher matrices, replay healing, ambiguous selector/error behavior, fallback text extraction, Android IME ownership edge cases | Keep selector/IME units; delete handler-level success duplicates. |
| `clipboard` | Android read/write, iOS read/write, macOS read/write, Linux read/write | physical-device unsupported cases and platform output parsing edge cases | Remaining happy-path clipboard unit tests should be rare deletion candidates. |
| `keyboard` | Android status/dismiss, iOS dismiss | keyboard state parsing, duplicate dumpsys fields, unsupported dismiss flows | Keep Android keyboard parser/dismiss edge tests. |
| `settings` | Android appearance/location/fingerprint/permission/animations; iOS appearance/location/permission; macOS appearance | invalid states, permission target mapping, location coordinate parsing, biometric fallbacks | Delete handler dispatch-shape duplicates only after platform/provider assertions cover the command. |
| `record`, `trace` | Android recording start/stop/pull; iOS simulator recording start/stop; iOS device recording and trace start/stop | telemetry timing, overlay generation, failure cleanup, artifact finalization | Delete successful lifecycle duplicates only when Device Lab proves equivalent artifact/telemetry coverage. |
| `logs` | iOS logs path/start/stop/mark/doctor, macOS logs path, Android logs doctor/start/stop | process lifecycle edge cases, tail/grep contracts, unavailable backend errors, clear/restart failure cleanup | Keep backend unit tests; delete handler orchestration happy paths covered by Device Lab. |
| `batch`, `replay` | Android batch and replay through a script | replay parser vars/env, healing, failure attribution | Keep replay parser/healing units; delete simple replay execution happy paths only. |

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

1. Review `src/daemon/handlers/__tests__/record-trace.test.ts` for pure lifecycle success duplicates. Keep timing, artifact, cancellation, cleanup, and telemetry units.
2. Review `src/daemon/handlers/__tests__/snapshot-handler.test.ts` for broad success duplicates now covered by scoped and macOS helper snapshots. Keep freshness and snapshot processing units.
3. Decide whether `ensure-simulator` removal in issue #549 should happen in this PR or immediately after merge.
4. Promote more generic provider operations to semantic contracts only when a second Adapter or Device Lab scenario would otherwise have to pattern-match host commands.
