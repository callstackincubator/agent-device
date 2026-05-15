# Unit Test Retention Policy

## Purpose

Device Lab scenarios should carry broad command and platform workflows. Unit tests should stay where a small, direct test gives better signal than a scenario: pure logic, parser matrices, selector semantics, capability maps, state machines, and edge/error branches.

This policy is the guardrail for deleting mock-heavy unit tests. Delete a unit test only when it is a happy-path orchestration duplicate covered by Device Lab and it does not protect one of the contracts below.

## Keep

| Area | Keep unit tests for | Examples |
| --- | --- | --- |
| CLI and public codecs | positional parsing, flag normalization, typed client option mapping, public schema stability | `src/__tests__/command-codecs.test.ts`, `src/utils/__tests__/args.test.ts`, `src/utils/__tests__/cli-option-schema.test.ts` |
| Selectors and assertions | selector parsing, matching, visibility semantics, `is` predicates, replay healing | `src/daemon/__tests__/selectors.test.ts`, `src/daemon/__tests__/is-predicates.test.ts`, `src/daemon/handlers/__tests__/replay-heal.test.ts` |
| Capability and dispatch policy | command support matrices, target/device resolution, invalid command shapes, gesture math | `src/core/__tests__/capabilities.test.ts`, `src/core/__tests__/dispatch-resolve.test.ts`, `src/core/__tests__/scroll-gesture.test.ts` |
| Request/session state | admission, locking, cancellation, leases, session persistence, runtime hints, artifact tracking | `src/daemon/__tests__/request-execution-scope.test.ts`, `src/daemon/__tests__/request-lock-policy.test.ts`, `src/daemon/__tests__/session-store.test.ts` |
| Snapshot processing | node shaping, pruning, scoped refs, hidden-content hints, output formatting, diffing | `src/daemon/__tests__/snapshot-processing.test.ts`, `src/daemon/handlers/__tests__/snapshot-scoped-refs.test.ts`, `src/utils/__tests__/output.test.ts` |
| Platform parsers and edge behavior | host-tool output parsing, retry/fallback state machines, provider scope routing, unsupported-device failures | `src/platforms/android/__tests__/snapshot.test.ts`, `src/platforms/android/__tests__/device-input-state.test.ts`, `src/platforms/ios/__tests__/runner-transport.test.ts` |
| Recording and logs internals | timing math, overlay events, stream cleanup, network log parsing, recovery notes | `src/daemon/__tests__/recording-gestures.test.ts`, `src/daemon/__tests__/network-log.test.ts`, `src/daemon/__tests__/app-log.test.ts` |

## Delete Candidates

Delete or avoid adding unit tests with these traits once Device Lab covers the same user workflow:

- handler tests that mock `dispatchCommand`, `ensureDeviceReady`, and platform modules only to assert a successful pass-through;
- tests that duplicate a Device Lab provider transcript without exercising an edge case;
- command-list or call-order assertions where order is not user-visible behavior;
- broad daemon handler success cases for `open`, `apps`, `appstate`, `clipboard`, `keyboard`, `settings`, `snapshot`, `press`, `fill`, `get`, `find`, `wait`, `record`, `trace`, `logs`, `batch`, or `replay` when the same command path is already covered by Device Lab;
- one-off tests for shapes TypeScript already guarantees.

## Handler Unit Tests That Still Earn Their Place

Handler tests can stay when they cover behavior that Device Lab would express poorly or make brittle:

- missing/ambiguous session errors;
- invalid flag combinations and user-facing hints;
- cancellation and cleanup paths;
- recording artifact finalization and failure cleanup;
- replay parsing, context metadata, and healing;
- selector ambiguity, stale refs, off-screen targets, and Android freshness checks;
- platform policy branches such as physical-device unsupported operations.

## Review Checklist

Before deleting a unit test, confirm:

1. A Device Lab scenario covers the successful user workflow through the request router and provider seam.
2. The unit test is not the only assertion for parser, selector, capability, state-machine, cleanup, or error behavior.
3. The remaining test failure would still be actionable: Device Lab catches the workflow, and smaller unit tests catch the narrow edge.
4. The command coverage matrix records the coverage source and any intentional gap.

Before adding a unit test, prefer Device Lab when the expected behavior crosses command routing, session state, dispatch, platform translation, or provider contracts.
