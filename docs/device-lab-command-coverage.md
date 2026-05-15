# Device Lab Command Coverage Matrix

This matrix is the deletion guide for mock-heavy unit tests. A unit test is a good deletion candidate when its happy path is covered by a Device Lab scenario and it does not assert a narrow parser, edge, or error contract.

Use `docs/unit-test-retention-policy.md` as the companion retention guide before deleting tests from this matrix.

| Command family | Device Lab coverage | Keep unit coverage for | Next action |
| --- | --- | --- | --- |
| `open`, `close`, `session_list`, `appstate` | Android lifecycle, iOS lifecycle, tvOS remote, macOS app/frontmost/desktop surfaces, Linux desktop | invalid open args, session conflict/lock behavior, runtime hint edge cases, close shutdown edge cases | Review remaining happy paths in `session.test.ts` and `session-close-shutdown.test.ts`. |
| `apps` | Android, iOS, macOS default and `--apps-filter all` flows | parser/default normalization, platform-specific app parser edge cases | Delete remaining handler-level list happy paths once parser/unit edge coverage is confirmed. |
| `install`, `reinstall` | Android reinstall, iOS simulator install/reinstall, iOS device reinstall | archive/materialization parsing, invalid install source, platform-specific failure mapping | Keep install-source unit tests; delete daemon happy-path reinstall duplicates. |
| `push` | Android lifecycle broadcast payload with extras | payload parsing and unsupported platform errors | Delete narrow Android push happy-path handler tests; keep invalid payload tests. |
| `snapshot`, `screenshot` | Android snapshot/screenshot and provider failure normalization, iOS snapshot, macOS snapshot, Linux snapshot/screenshot | snapshot processing, selector pruning, screenshot scaling/format edge cases | Add scoped snapshot flags to Device Lab before deleting more snapshot handler tests. |
| `press`, `click`, `focus`, `longpress`, `swipe`, `scroll`, `type` | Android press/click/fill; iOS press; tvOS remote scroll/back/home; macOS press; Linux pointer, click buttons, swipe, scroll, type | selector resolution edge cases, platform-specific coordinate translation, invalid flag combinations | Review `interaction.test.ts` for raw happy paths now covered by Linux/Android/macOS scenarios. |
| `fill`, `get`, `is`, `find`, `wait` | Android fill/get/is/find/wait; iOS get/is/find/wait | selector parser/matcher matrices, replay healing, ambiguous selector/error behavior, Android IME ownership edge cases | Keep selector/IME units; delete handler-level success duplicates. |
| `clipboard` | Android read/write, iOS read/write, macOS read/write, Linux read/write | physical-device unsupported cases and platform output parsing edge cases | Remaining happy-path clipboard unit tests should be rare deletion candidates. |
| `keyboard` | Android status/dismiss, iOS dismiss | keyboard state parsing, duplicate dumpsys fields, unsupported dismiss flows | Keep Android keyboard parser/dismiss edge tests. |
| `settings` | Android appearance/location/fingerprint/permission/animations; iOS appearance/permission; macOS appearance | invalid states, permission target mapping, location coordinate parsing, biometric fallbacks | Add iOS location before deleting more settings units. |
| `record`, `trace` | Android recording start/stop/pull; iOS device recording and trace start/stop | telemetry timing, overlay generation, failure cleanup, artifact finalization | Review `record-trace.test.ts` for successful flow duplicates; keep timing/error units. |
| `logs` | iOS logs path/mark/doctor, macOS logs path, Android logs doctor | process lifecycle, tail/grep contracts, unavailable backend errors | Keep backend unit tests; delete handler orchestration happy paths covered by Device Lab. |
| `batch`, `replay` | Android batch and replay through a script | replay parser vars/env, healing, failure attribution | Keep replay parser/healing units; delete simple replay execution happy paths only. |

## Current Deletion Priorities

1. `src/daemon/handlers/__tests__/session.test.ts`: remove remaining plain open/close/apps/appstate/replay happy paths that do not exercise edge behavior.
2. `src/daemon/handlers/__tests__/interaction.test.ts`: remove raw press/click/fill/get/is success cases covered by Device Lab; keep selector ambiguity and platform-specific policy cases.
3. `src/daemon/handlers/__tests__/record-trace.test.ts`: remove successful record/trace lifecycle duplicates; keep timing, artifact, cancellation, and failure cleanup tests.
4. `src/daemon/handlers/__tests__/snapshot-handler.test.ts`: defer broad deletion until Device Lab covers more snapshot flags and scoped snapshots.

## Coverage Gaps Before More Deletion

- iOS settings location flows.
- Snapshot scoped output and important snapshot flags.
- Logs start/stop lifecycle beyond path/mark/doctor.
- More explicit negative scenarios in Device Lab for provider failures where handler behavior matters.
