# ADR 0001: Provider-First Device Lab

## Status

Accepted

## Context

The test suite had many mocked daemon handler and dispatch unit tests. Those tests were expensive to maintain and skipped important behavior across request admission, locking, session state, handler routing, dispatch, Interactor resolution, and platform module command translation.

Android already had an ADB provider seam. Apple-family and Linux platform modules mostly called host tools or runner commands directly, which made device-free integration tests difficult without mocking too high in the stack.

## Decision

Keep `Interactor` as the semantic interface between dispatch and platform behavior.

Add request-scoped provider seams below platform modules:

- Android ADB provider
- Apple tool provider
- Apple runner provider
- Linux tool provider

Provider contracts should expose semantic operations when the platform intent is stable enough to name. Android already does this for install, pull, and port-reverse behavior. Apple tool execution has started moving in that direction with semantic `simctl` and `devicectl` runners; generic command execution remains as a local compatibility fallback for host-tool paths that have not been classified yet. Linux still uses a generic tool provider because the current desktop surface is smaller and less cloud-adapter-shaped; split it when a second backend forces clearer language.

Device Lab tests run the real daemon request path and replace only those providers. Tests may use provider transcripts for platform command contracts and scenario transcripts for broader user workflows. Provider transcripts match calls as an unordered contract by default; use ordered transcripts only when ordering is the behavior under test.

Prefer an in-process Device Lab harness for broad scenarios: it should invoke the daemon request handler directly, preserving admission, locking, session state, handler routing, dispatch, platform modules, and provider seams without binding a TCP listener. Keep HTTP coverage as a narrow contract suite for JSON-RPC transport, auth, and response finalization.

Synchronous host-tool calls are intentionally not part of the provider seam. Any remaining sync Apple helper is local-only and must be converted before a remote/cloud provider can own that path.

## Alternatives Considered

- Mock handlers or `dispatchCommand`: cheaper to write, but it skips request admission, locking, session state, and platform command translation, which were the main sources of test blind spots.
- Put the seam at `Interactor`: simpler and more uniform, but it bypasses platform modules and would not catch the iOS/Linux host-tool wiring issues that motivated this change.
- Start with a full semantic provider per platform operation: cleaner end state, but too much surface to name correctly in one pass. The migration starts where contracts already exist or where tests create pressure.
- Run every Device Lab scenario through HTTP: maximum end-to-end coverage, but it makes most scenarios pay for TCP setup, sandbox permissions, and transport timeouts even when transport behavior is not under test.

## Consequences

Platform command translation remains covered by integration tests without requiring real devices.

The request router owns a provider registry seam, but platform-specific provider applicability remains localized in that registry. The registry composes provider scopes linearly so adding a platform does not require another nested wrapper chain.

New remote or cloud-backed adapters can implement neutral provider contracts without changing daemon, dispatch, or session contracts. Generic tool-provider fallbacks are an interim compatibility layer, not the target contract for cloud adapters.

Mock-heavy handler unit tests should be deleted only after equivalent Device Lab scenario coverage exists. Unit tests remain appropriate for pure logic, parser matrices, selector matching, capability maps, and edge/error cases that integration tests would express poorly.

The trade-off is coarser failure localization: a Device Lab scenario catches more of the real request path but may require more diagnosis than a narrow unit test. Scenario names and provider transcript entries should stay rooted in user workflows and real e2e examples so failures remain actionable.

Coverage is expected to improve over the old handler-heavy unit suite, but the first migration does not meet the original 90% target. The current coverage denominator also excludes some entrypoint and MCP/config files, so coverage should be treated as a trend signal rather than proof that every public surface is exercised.
