# Agent Device Domain Context

## Terms

- Device Lab: device-free integration tests that run the real daemon request path and replace only external device or host tool execution.
- Provider: request-scoped adapter interface for external device, runner, or host tool execution.
- Provider transcript: exact record of provider calls used when a test must verify platform command translation.
- Scenario transcript: command-level Device Lab flow that describes user-visible behavior through daemon commands.
- Interactor: semantic interface between command dispatch and platform behavior.
- Platform module: platform-specific implementation behind the Interactor.
- Target: selected automation destination, such as mobile, tv, or desktop.
- Modality: broad supported device family, such as mobile, tv, or desktop.
- Session: daemon-owned state for a selected target and opened app or surface.

## Testing Principles

- Device Lab tests should exercise the public daemon path whenever practical.
- Provider seams sit below platform modules so integration tests still cover platform command translation.
- Provider transcripts are for exact external command contracts.
- Scenario transcripts are for broad, user-rooted workflows that should replace mocked handler unit tests.
- Unit tests stay for pure logic, parser matrices, selector matching, capabilities, and important edge cases.
