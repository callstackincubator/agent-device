# agent-device iOS Runner

This folder is reserved for the lightweight XCUITest runner used to provide element-level automation on iOS.

## Intent
- Provide a minimal XCTest target that exposes UI automation over a small HTTP server.
- Allow local builds via `xcodebuild` and caching for faster subsequent runs.
- Support simulator prebuilds where compatible.

## Status
Planned for the automation layer. See `docs/ios-automation.md` and `docs/ios-runner-protocol.md`.
