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
| Handler unit test LOC | 14110 |
| Handler unit tests | 400 |
| Handler files with `vi.mock` | 18 |
| Device Lab files | 10 |
| Device Lab LOC | 2294 |
| Device Lab tests | 16 |
| Device Lab / handler LOC | 16.3% |

Coverage is tracked separately by:

```sh
pnpm test:coverage:check
```

Current local coverage: 78.37% statements, 68.39% branches, 86.04% functions, 80.36% lines.

Gates:

- Statement regression floor: 78%.
- Line regression floor: 80%.
- Near-term statement target: 80%.

Do not raise floors by adding tests that only execute code. Added coverage must assert user-visible behavior, provider contracts, parser contracts, or important edge/error handling.

## Coverage Leverage Backlog

Latest `pnpm test:coverage` snapshot shows the biggest low-coverage implementation files:

| File | Coverage | Missing statements | Device Lab fit | Real scenario to add |
| --- | ---: | ---: | --- | --- |
| `src/daemon-client.ts` | 44.38% | 272 | Partial | Keep one transport smoke flow; do not duplicate every client startup branch in Device Lab. Prefer direct request-handler tests for provider behavior and a small CLI/daemon smoke check for daemon discovery. |
| `src/client-companion-tunnel-worker.ts` | 1.11% | 266 | Poor | Existing child-process tests cover real tunnel behavior but V8 does not attribute subprocess execution here. Do not chase this with synthetic coverage; improve subprocess coverage separately if needed. |
| `src/daemon/http-server.ts` | 56.13% | 118 | Partial | Existing HTTP smoke tests cover lease/auth/upload paths, but they are outside the coverage command. Keep one HTTP transport integration path; Device Lab should invoke the request handler directly for command/provider behavior. |
| `src/platforms/ios/runner-session.ts` | 17.64% | 112 | Medium | Add runner-provider scenarios for start, retry, reconnect, and crashed runner responses when the behavior is visible through iOS command execution. Keep fine-grained runner state-machine units. |
| `src/daemon.ts` | 0% | 89 | Poor | Entrypoint wiring belongs in one smoke/packaging test, not Device Lab. |
| `src/platforms/android/manifest.ts` | 35.16% | 83 | Medium | Cover APK install/reinstall with a realistic manifest fixture and semantic Android provider assertions. Keep parser edge cases as units. |
| `src/daemon/transport.ts` | 0% | 80 | Poor | Transport selection is better covered by CLI/client smoke tests than command Device Lab tests. |
| `src/daemon/handlers/find.ts` | 43.47% | 78 | Good | Add a real multi-step `find` scenario: snapshot list, selector query, first/all behavior, and follow-up command using the found ref. This can replace handler success-path units. |
| `src/platforms/ios/macos-helper.ts` | 46.82% | 67 | Good | Add macOS helper-backed alert and permission scenarios that assert user-visible status and provider calls. |
| `src/platforms/ios/ensure-simulator.ts` | 0% | 61 | Omit | Track removal separately instead of adding coverage. The command was demo-driven lifecycle policy and should not anchor this provider refactor. See issue #549. |

Priority order:

1. `find` Device Lab expansion: broad handler/selector/session value and strong unit-deletion potential.
2. macOS helper alert/permission Device Lab: covers desktop modality without real devices and exercises the helper seam.
3. Android manifest install scenario: good leverage, but keep parser units for malformed manifests.
4. Runner session resilience: valuable, but more state-machine-oriented; add only behavior visible through user commands.
5. Coverage accounting: avoid synthetic tests for subprocess and entrypoint files; document or measure those through smoke/packaging tests instead.

## Command Matrix

| Command family | Device Lab coverage | Keep unit coverage for | Next action |
| --- | --- | --- | --- |
| `open`, `close`, `session_list`, `appstate` | Android lifecycle, active/closed iOS session listing, tvOS remote, macOS app/frontmost/desktop surfaces, Linux desktop | invalid open args, session conflict/lock behavior, runtime hint edge cases, close shutdown edge cases, scoped simulator set field shaping | Keep remaining session units unless they assert a plain success path with no policy or field-shaping edge. |
| `apps` | Android, iOS, macOS default and `--apps-filter all` flows | parser/default normalization, typed client flag forwarding, platform-specific app parser edge cases | Broad Device Lab and parser/client coverage are in place; no handler-level list happy path remains to delete. |
| `install`, `reinstall` | Android reinstall, iOS simulator install/reinstall, iOS device reinstall | archive/materialization parsing, invalid install source, platform-specific failure mapping | Keep install-source unit tests; delete daemon happy-path reinstall duplicates. |
| `push` | Android lifecycle broadcast payload with extras | payload parsing and unsupported platform errors | Delete narrow Android push happy-path handler tests; keep invalid payload tests. |
| `snapshot`, `screenshot` | Android snapshot/screenshot and provider failure normalization, iOS snapshot, macOS frontmost and desktop surface snapshots, Linux snapshot/screenshot, scoped Linux `@ref`/depth snapshots | snapshot processing, selector pruning, screenshot scaling/format edge cases, Android freshness retries, macOS scoped/menubar edge cases | Delete only broad snapshot handler duplicates; keep narrow processing and freshness units. |
| `press`, `click`, `focus`, `longpress`, `swipe`, `scroll`, `type` | Android press/click/fill; iOS press; tvOS remote scroll/back/home; macOS press; Linux pointer, click buttons, swipe, scroll, type, and session action recording | selector resolution edge cases, platform-specific coordinate translation, invalid flag combinations | Remaining interaction units mostly protect edge behavior; delete only newly duplicated plain successes. |
| `fill`, `get`, `is`, `find`, `wait` | Android fill/get/is/find/wait; iOS get/is/find/wait; macOS helper-backed `get text @ref` read expansion | selector parser/matcher matrices, replay healing, ambiguous selector/error behavior, fallback text extraction, Android IME ownership edge cases | Keep selector/IME units; delete handler-level success duplicates. |
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

1. Add Android manifest install/reinstall Device Lab coverage with realistic APK metadata fixture and semantic provider assertions.
2. Review `src/daemon/handlers/__tests__/record-trace.test.ts` for pure lifecycle success duplicates. Keep timing, artifact, cancellation, cleanup, and telemetry units.
3. Review `src/daemon/handlers/__tests__/snapshot-handler.test.ts` for broad success duplicates now covered by scoped and macOS helper snapshots. Keep freshness and snapshot processing units.
4. Promote more generic provider operations to semantic contracts only when a second Adapter or Device Lab scenario would otherwise have to pattern-match host commands.
