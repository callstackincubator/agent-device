# Agent Device Domain Context

## Terms

- Provider-backed integration scenario: device-free integration test that runs the real daemon request path and replaces only external device or host tool execution.
- Provider: request-scoped adapter interface for external device, runner, or host tool execution.
- Provider transcript: exact record of provider calls used when a test must verify platform command translation.
- Scenario transcript: command-level integration flow that describes user-visible behavior through daemon commands.
- In-process provider scenario harness: integration runner that invokes the daemon request handler directly without opening an HTTP listener.
- HTTP contract test: narrow test that verifies JSON-RPC transport, auth, and response finalization over the daemon HTTP boundary.
- Interactor: semantic interface between command dispatch and platform behavior.
- Platform module: platform-specific implementation behind the Interactor.
- Target: selected automation destination, such as mobile, tv, or desktop.
- Modality: broad supported device family, such as mobile, tv, or desktop.
- Session: daemon-owned state for a selected target and opened app or surface.
- Command surface: catalog of public command identity, interface exposure, adapter policy, and shared command metadata across CLI, Node.js, MCP, and batch entrypoints.
- Daemon command registry: daemon-side source of truth for command route ownership and request-policy traits, including admission exemptions, session locking, selector validation, replay-scoped actions, recording invalidation, Android dialog guards, and request provider device resolution.
- Runner command traits: the iOS XCTest runner's per-command-type classification across three independent axes — interaction (gates the foreground-guard and stabilization preflight), read-only (gates the session-invalidating retry; the alert command is read-only only for its `get` action), and runner-lifecycle (skips the app-activation preflight). One source of truth keyed by command type, distinct from the public command surface and daemon command registry.

## Testing Principles

- Provider-backed integration scenarios should exercise the public daemon path whenever practical.
- Prefer the in-process provider scenario harness for broad scenarios; keep HTTP contract tests narrow and transport-specific.
- Provider seams sit below platform modules so integration tests still cover platform command translation.
- Provider transcripts are for exact external command contracts.
- Scenario transcripts are for broad, user-rooted workflows that should replace mocked handler unit tests.
- Unit tests stay for pure logic, parser matrices, selector matching, capabilities, and important edge cases.
