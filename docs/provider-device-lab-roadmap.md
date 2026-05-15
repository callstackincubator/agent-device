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
- [x] Reassess provider contracts after Device Lab migration; promote Linux desktop lifecycle after Device Lab created real remote-provider pressure.
- [x] Remove Device Lab assertions that only restated the scenario command list.
- [x] Add a provider-failure Device Lab scenario that exercises request finalization.
- [x] Document which unit tests should stay after the Device Lab migration.

## Remaining Work

- [x] Build a command coverage matrix mapping each command/flag family to Device Lab coverage, unit edge coverage, or intentional gap.
- [x] Use that matrix for another deletion pass over mock-heavy handler tests.
- [x] Keep unit tests for pure logic, parser matrices, selector matching, capability maps, and edge/error branches.
- [x] Promote additional generic provider operations to semantic contracts only when Device Lab scenarios or remote-provider needs create pressure.
- [x] Track coverage as a trend signal, with a near-term target of roughly 80-82% statements from valuable tests before considering a larger 90% push.

## Current Known Gaps

- Remaining handler tests still contain large mocked suites, especially interaction, snapshot, and record/trace coverage. Use `docs/unit-test-retention-policy.md` before deleting more.
- Apple and Linux providers still keep generic command fallbacks for host-tool paths that have not earned semantic contracts yet.
- Linux desktop lifecycle now has a semantic provider contract for `open` and `close`; input, clipboard, screenshot, and accessibility snapshot remain generic until another backend creates clearer pressure.
- Device Lab now covers scoped snapshot refs/depth, iOS simulator location, and Android/iOS logs start/stop lifecycle, so those are no longer blockers for targeted handler-test deletion.
- Coverage tracking now uses `pnpm test:coverage:check` and `docs/coverage-trend.md`: 78% statements is the regression floor, 80% statements is the near-term target, and the original 90% goal remains deferred until coverage comes from valuable integration and edge tests.

## Architecture Review

The provider-first Device Lab architecture is still the right shape. The deep modules are the `Interactor` seam, the request-scoped Provider seams below Platform modules, and the in-process Device Lab harness. They pass the deletion test: deleting any of them would spread request admission, session state, platform command translation, and external-tool scripting back across handlers and tests.

The architecture should not move the Device Lab seam up to `Interactor`. That would simplify tests, but it would lose platform module coverage, which was the original testing gap. It should also not promote every host-tool call into a semantic Provider method in one sweep. A Provider method earns its depth when Device Lab scenarios or a second Adapter make the intent stable enough to name.

The main missing pieces are no longer foundational architecture. They are completion work: continue deleting mock-heavy handler tests only where the command coverage matrix proves equivalent Device Lab coverage, add valuable Device Lab scenarios for the documented gaps, and promote remaining generic Provider operations only when a real Adapter would otherwise have to pattern-match host commands.

## Provider Contract Checkpoint

Linux desktop lifecycle has been promoted to a semantic provider contract because Device Lab already exercises `open` and `close`, and a remote desktop backend should not have to pattern-match `xdg-open`, app binaries, `wmctrl`, or `pkill` to recover intent. Android already exposes semantic operations where remote backends need them. Apple has semantic `simctl`, `devicectl`, and plist hooks, with generic command execution retained as compatibility fallback for host-tool paths that have not been classified yet. Linux input, clipboard, screenshot, and accessibility snapshot remain generic because their current contracts are still local-tool-specific; split them when a second backend would otherwise need to pattern-match command arguments.
