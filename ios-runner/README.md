# agent-device iOS Runner

This folder contains the lightweight XCUITest runner used to provide element-level automation for Apple-family targets.

## Intent

- Provide a minimal XCTest target that exposes UI automation over a small HTTP server.
- Allow local builds via `xcodebuild` and caching for faster subsequent runs.
- Support simulator prebuilds where compatible.

## Status

Current internal runner for iOS, tvOS, and macOS desktop automation.

Protocol and maintenance references:

- Protocol overview: [`RUNNER_PROTOCOL.md`](RUNNER_PROTOCOL.md)
- TypeScript client: [`../src/platforms/ios/runner-client.ts`](../src/platforms/ios/runner-client.ts)
- Swift wire models: [`AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests+Models.swift`](AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests+Models.swift)

## UITest Runner File Map

`AgentDeviceRunnerUITests/RunnerTests` is split into focused files to reduce context size for contributors and LLM agents.

- `RunnerTests.swift`: shared state/constants, `setUp()`, and `testCommand()` entry flow.
- `RunnerTests+Models.swift`: wire protocol models (`Command`, `Response`, snapshot payload models).
- `RunnerTests+Environment.swift`: environment and CLI argument helpers (`RunnerEnv`).
- `RunnerTests+Transport.swift`: TCP request handling and HTTP parsing/encoding.
- `RunnerTests+CommandExecution.swift`: command dispatch (`execute*`) and command switch.
- `RunnerTests+Lifecycle.swift`: activation/retry/stabilization and recording lifecycle helpers.
- `RunnerTests+Interaction.swift`: tap/drag/swipe/type/back/home/app-switcher helpers.
- `RunnerTests+Snapshot.swift`: fast/raw snapshot builders and include/filter helpers.
- `RunnerTests+SystemModal.swift`: SpringBoard/system modal detection and modal snapshot shaping.
- `RunnerTests+ScreenRecorder.swift`: nested `ScreenRecorder` implementation.

## Protocol Notes

- The daemon posts JSON commands to `POST /command` on the runner's local HTTP listener.
- The runner responds with a JSON envelope shaped as `{ ok, data?, error? }`.
- The protocol is internal to `agent-device`; when adding or renaming commands, update both wire models and the protocol tests/docs in the same change.
