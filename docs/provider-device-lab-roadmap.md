# Provider-First Device Lab Roadmap

## Goal

Move broad command coverage from mock-heavy handler unit tests into Device Lab integration scenarios that run through request admission, locking, session state, handlers, dispatch, platform modules, and request-scoped providers without requiring real devices.

## Progress

- [x] Document provider-first testing architecture in `docs/adr/0001-provider-first-device-lab.md`.
- [x] Add request-scoped Android, Apple runner, Apple tool, and Linux provider seams.
- [x] Add Device Lab scenarios for Android, iOS simulator, iOS device install/recording, tvOS, macOS, and Linux.
- [x] Wire Device Lab into `pnpm test:integration` and CI.
- [x] Move broad Device Lab scenarios to an in-process request-handler harness.
- [x] Keep HTTP coverage in smoke tests for JSON-RPC transport, auth, and response finalization.
- [x] Delete the first batch of Device Lab-covered happy-path unit tests.
- [x] Reassess provider contracts after Device Lab migration; no additional semantic provider method is currently justified.
- [x] Remove Device Lab assertions that only restated the scenario command list.
- [x] Add a provider-failure Device Lab scenario that exercises request finalization.
- [x] Document which unit tests should stay after the Device Lab migration.

## Remaining Work

- [x] Build a command coverage matrix mapping each command/flag family to Device Lab coverage, unit edge coverage, or intentional gap.
- [x] Use that matrix for another deletion pass over mock-heavy handler tests.
- [x] Keep unit tests for pure logic, parser matrices, selector matching, capability maps, and edge/error branches.
- [ ] Promote additional generic provider operations to semantic contracts only when Device Lab scenarios or remote-provider needs create pressure.
- [ ] Track coverage as a trend signal, with a near-term target of roughly 80-82% statements from valuable tests before considering a larger 90% push.

## Current Known Gaps

- Remaining handler tests still contain large mocked suites, especially interaction, snapshot, and record/trace coverage. Use `docs/unit-test-retention-policy.md` before deleting more.
- Apple and Linux providers still keep generic command fallbacks for host-tool paths that have not earned semantic contracts yet.
- Coverage is around 78% statements / 80% lines, not the original 90% goal. The coverage run counts Vitest suites, so HTTP smoke coverage from `node --test` does not contribute to the percentage.

## Provider Contract Checkpoint

No new provider method is being added in this pass. Android already exposes semantic operations where remote backends need them. Apple has semantic `simctl`, `devicectl`, and plist hooks, with generic command execution retained as compatibility fallback for host-tool paths that have not been classified yet. Linux remains generic because Device Lab currently exercises one local desktop backend; split it when a second backend would otherwise need to pattern-match command arguments.
