# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Code Style

- Do not use emojis in code, output, or documentation. Unicode symbols (✓, ✗, →, ⚠) are acceptable.
- Use `runCmd`/`runCmdSync` from `src/utils/exec.ts` for process execution; avoid direct `spawn`/`spawnSync`.
- Commands should use the daemon session model; open a session before interactions and close it after.
- When removing a command (e.g., `rect`), ensure shared model types remain intact (e.g., snapshot structs used by other code paths) and verify with `pnpm typecheck` + a runner build if Swift files changed.

## Overview

- CLI entry: `src/bin.ts` -> `src/cli.ts`.
- Daemon: `src/daemon.ts`, started on demand by `src/daemon-client.ts`.
- Core dispatcher: `src/core/dispatch.ts` routes commands to platform interactors.
- iOS runner (simulator-only, v1): `src/platforms/ios/runner-client.ts` drives a UI test runner app.
- iOS AX snapshot tool: `ios-runner/AXSnapshot` (SwiftPM CLI) used for fast accessibility snapshots.
- iOS runner Xcode project: `ios-runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj`.
- iOS runner UI test: `ios-runner/AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests.swift`.
- Android: `src/platforms/android/*` with ADB utilities.

## Architecture (runtime flow)

1) CLI parses args in `src/cli.ts`, then sends a request to the daemon.
2) Daemon (`src/daemon.ts`) resolves device, tracks session state, and calls `dispatchCommand`.
3) `dispatchCommand` selects platform interactor.
4) iOS simulator path:
   - Snapshot default backend: XCTest for everything, fallback to AX if XCTest returns 0 nodes.
5) iOS runner uses xcodebuild `test-without-building` with an injected `.xctestrun`,
   starts an `NWListener` HTTP server inside the UI test bundle, and executes UI actions.

## Key commands (local)

- Build iOS runner: `pnpm build:xcuitest`
- Build AX snapshot tool: `pnpm build:axsnapshot`
- Build everything: `pnpm build:all`
- Run command: `pnpm ad`

## Run and Test

- Run CLI (preferred): `pnpm ad <command>`
- Build JS + Swift artifacts: `pnpm build:all`
- Typecheck: `pnpm typecheck`
- Tests: `pnpm test` (all), `pnpm test:smoke`, `pnpm test:integration`

## iOS runner details

- Test method name used by CLI: `RunnerTests.testCommand`.
- The UI test launches the target app and listens for HTTP on a dynamic port.
- Port injection uses `.xctestrun` env vars and `AGENT_DEVICE_RUNNER_PORT`.
- Logs of readiness: `AGENT_DEVICE_RUNNER_LISTENER_READY` and `AGENT_DEVICE_RUNNER_PORT=...`.
- Main-thread UI actions are mandatory (XCUIApplication).
- Real device support (including snapshots) is on the roadmap for iOS.

## Daemon details

- Daemon info: `~/.agent-device/daemon.json` (port/token/pid/version).
- Daemon log: `~/.agent-device/daemon.log` (also tailed in verbose mode).
- Session logs: `~/.agent-device/sessions/<session>-<timestamp>.ad` (plain text actions).

## Environment variables

- `AGENT_DEVICE_RUNNER_PORT`: port passed into the UI test bundle.
- `AGENT_DEVICE_IOS_CLEAN_DERIVED=1`: delete `~/.agent-device/ios-runner/derived` before building/selecting xctestrun.
- `AGENT_DEVICE_DAEMON_TIMEOUT_MS`: timeout for daemon request response (min 1000ms, default 60000).

## Common failure modes

- "Runner did not accept connection":
  - Stale `.xctestrun` was selected; clean derived or rebuild.
  - Listener not ready yet; check daemon log for readiness markers.
- XCTest main-thread crash: ensure UI actions run on main thread.

## Files to check when debugging

- `src/platforms/ios/runner-client.ts` (xcodebuild, xctestrun injection, HTTP connect logic)
- `ios-runner/AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests.swift` (listener + UI actions)
- `src/daemon-client.ts` and `src/daemon.ts` (daemon startup and request flow)
- `src/core/dispatch.ts` (command routing and iOS simctl fallback)
