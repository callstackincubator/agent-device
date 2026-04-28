# Introduction

`agent-device` is a CLI for automating iOS simulators + physical devices and Android emulators + devices from agents. It provides:

- Accessibility snapshots for UI understanding
- Deterministic interactions (tap, type, scroll)
- Session-aware workflows and replay
- Session logs and network inspection for debugging broken flows
- Performance snapshots with `perf`/`metrics`, including CPU and memory data where supported

If you know `agent-browser`, this is the mobile-native counterpart for iOS/Android UI automation and app-level observability.
For agent-oriented operating guidance, start with `agent-device help` or `agent-device help workflow`. Skills are recommended auto-routing helpers when your agent runtime supports them, but agents can operate from CLI help alone. For exploratory QA, use `agent-device help dogfood`. For React Native component trees, props/state/hooks, and render profiling, use `agent-device help react-devtools` and the `agent-device react-devtools` passthrough.

## What it’s good at

- Exploring and driving app flows on real devices and simulators
- Collecting debugging evidence through logs, network traffic, screenshots, recordings, and performance snapshots
- Replaying successful flows as lightweight regression checks

## Platform support highlights

- iOS core runner commands: `snapshot`, `snapshot --diff`, `diff snapshot`, `wait`, `click`, `fill`, `get`, `is`, `find`, `press`, `long-press`, `focus`, `type`, `scroll`, `back`, `home`, `rotate`, `app-switcher`, `open` (app), `close`, `screenshot`, `apps`, `appstate`, `install`, `install-from-source`, `reinstall`, `trigger-app-event`.
- iOS `appstate` is session-scoped on the selected target device.
- iOS/tvOS simulator-only: `settings`, `push`, `clipboard`.
- Apple simulators and macOS desktop app sessions: `alert`, `pinch`.
- Session diagnostics: `logs` and `network dump` are available for debugging active app sessions, with network inspection based on recent HTTP(s) entries captured in the session app log.
- Session performance metrics: `perf`/`metrics` is available on iOS, macOS, and Android. Startup timing comes from `open` command round-trip duration. Android app sessions and Apple app sessions on macOS, iOS simulators, or connected iOS devices also expose CPU and memory snapshots when an app identifier is available in the session.
- iOS `record` supports simulators and physical devices.
  - Simulators use native `simctl io ... recordVideo`.
  - Physical devices use runner screenshot capture (`XCUIScreen.main.screenshot()` frames) stitched into MP4, so FPS is best-effort (not guaranteed 60 even with `--fps 60`).
  - Physical-device recording requires an active app session context (`open <app>` first).
  - Physical-device recording defaults to 15 FPS and supports `--fps` caps.
  - `record start --quality <5-10>` scales recording resolution from 50% through native resolution; omitting it keeps native/current resolution.
- Android supports the same core interaction set, plus `rotate`, `push` notification simulation, `clipboard read/write`, and `keyboard status|get|dismiss`.
- iOS supports `keyboard dismiss` through the XCTest runner when the on-screen keyboard is visible.
- App-event triggers are available on iOS and Android through app-defined deep-link hooks (`trigger-app-event`), using active session context or explicit device selectors.

## Architecture (high level)

1. CLI sends requests to the daemon.
2. The daemon manages sessions and dispatches to platform drivers.
3. iOS uses XCTest runner for snapshots and input on simulators and physical devices.
4. Android uses ADB-based tooling.

## Complementary React tooling

`agent-device` is intentionally centered on the device/app layer: UI automation, screenshots/recordings, app logs, network inspection, and performance sampling.

When a React Native debugging workflow needs React internals such as the component tree, props, state, hooks, or render profiling, use `agent-device react-devtools` alongside normal device commands:

```bash
agent-device react-devtools status
agent-device react-devtools get tree --depth 3
agent-device react-devtools profile start
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
```

## Example

```bash
# Navigate and get snapshot
agent-device open Settings --platform ios
agent-device snapshot -i
# Output
# Page: Contacts
# App: com.apple.MobileAddressBook
# Snapshot: 44 nodes
# @e1 [application] "Contacts"
#  @e2 [window]
#    @e3 [other]
#  @e4 [other] "Lists"
#    @e5 [navigation-bar] "Lists"
#      @e6 [button] "Lists"
#      @e7 [text] "Contacts"
#    @e8 [other] "John Doe"

# Click and fill
agent-device click @e8
agent-device snapshot -i
agent-device diff snapshot
agent-device fill @e5 "Doe 2"
agent-device close
```
