# agent-device iOS Runner

This folder is reserved for the lightweight XCUITest runner used to provide element-level automation on iOS.

## Intent
- Provide a minimal XCTest target that exposes UI automation over a small HTTP server.
- Allow local builds via `xcodebuild` and caching for faster subsequent runs.
- Support simulator prebuilds where compatible.

## Status
Planned for the automation layer. See `docs/ios-automation.md` and `docs/ios-runner-protocol.md`.

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
