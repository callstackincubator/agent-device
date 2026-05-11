# Introduction

`agent-device` is an agent-native CLI for AI mobile testing and app verification from coding agents. It automates iOS simulators, iOS physical devices, Android emulators, Android devices, tvOS, Android TV, macOS apps, and Linux desktop apps.

It provides:

- Accessibility snapshots for UI understanding
- Deterministic interactions (tap, type, scroll)
- Session-aware workflows and replay
- Session logs, network inspection, traces, and crash-related logs for debugging broken flows
- Performance snapshots with `perf`/`metrics`, including startup, CPU, memory, and frame-health data where supported
- React Native and Expo workflows through device automation plus optional React DevTools profiling

If you know `agent-browser`, this is the mobile-native counterpart for iOS/Android UI automation and app-level observability.
For agent-oriented operating guidance, start with `agent-device help` or `agent-device help workflow`. Skills are recommended auto-routing helpers when your agent runtime supports them, but agents can operate from CLI help alone. For exploratory QA, use `agent-device help dogfood`. For React Native component trees, props/state/hooks, and render profiling, use `agent-device help react-devtools` and the `agent-device react-devtools` passthrough.

## What it’s good at

- Exploring and driving mobile, TV, and desktop app flows on real devices, simulators, and emulators
- Collecting debugging evidence through logs, network traffic, screenshots, recordings, traces, crash-related logs, CPU/memory snapshots, and performance data
- Replaying successful flows as lightweight regression checks

## Where it fits

`agent-device` is for agents that need to inspect and operate real apps. Humans install it, grant permissions, review artifacts, and decide when an agent should use it.

The UI model is accessibility-first and token-efficient, so agents can reason over compact snapshots instead of relying only on screenshots. MCP support is intentionally a thin discovery router for status, install guidance, and version-matched help; app/device automation remains explicit CLI activity in the terminal.

It complements scripted test frameworks such as Appium, Maestro, Detox, XCTest, and Espresso. Use those for stable human-authored coverage. Use `agent-device` when an agent needs to explore, reproduce, debug, profile, collect evidence, or turn a successful session into a replayable `.ad` flow.

`agent-device` closes the agentic development loop: agents can write code, run the real app, verify the UI end-to-end, collect screenshots/videos/logs/perf evidence, and feed bugs, crashes, or performance findings back into the next fix iteration before a human reviews the PR.

![Sketch showing agent-device as the live app verification layer in the agentic development loop](/agentic-development-loop.svg)

## Platform support highlights

- iOS core runner commands: `snapshot`, `snapshot --diff`, `diff snapshot`, `wait`, `click`, `fill`, `get`, `is`, `find`, `press`, `long-press`, `focus`, `type`, `scroll`, `back`, `home`, `rotate`, `app-switcher`, `open` (app), `close`, `screenshot`, `apps`, `appstate`, `install`, `install-from-source`, `reinstall`, `trigger-app-event`.
- iOS `appstate` is session-scoped on the selected target device.
- iOS/tvOS simulator-only: `settings`, `push`, `clipboard`.
- Apple simulators and macOS desktop app sessions: `alert`, `pinch`.
- Session diagnostics: `logs` and `network dump` are available for debugging active app sessions, with network inspection based on recent HTTP(s) entries captured in the session app log.
- Session performance metrics: `perf`/`metrics` is available on iOS, macOS, and Android. Startup timing comes from `open` command round-trip duration. Android app sessions expose CPU, memory, and rendered-frame health; connected iOS device app sessions expose CPU, memory, and `xctrace` Animation Hitches frame health. Use `metrics.fps.droppedFramePercent` as the primary frame-smoothness signal, and `metrics.fps.worstWindows` to correlate jank clusters with logs or recent interactions. Apple app sessions on macOS or iOS simulators expose CPU and memory snapshots when an app identifier is available, but report frame health unavailable. Android dropped-frame data comes from the current `dumpsys gfxinfo ... framestats` window, is reset after each successful `perf` read, and is not video recording FPS.
- iOS `record` supports simulators and physical devices.
  - Simulators use native `simctl io ... recordVideo`.
  - Physical devices use runner screenshot capture (`XCUIScreen.main.screenshot()` frames) stitched into MP4, so FPS is best-effort (not guaranteed 60 even with `--fps 60`).
  - Physical-device recording requires an active app session context (`open <app>` first).
  - Physical-device recording defaults to 15 FPS and supports `--fps` caps.
  - `record start --quality <5-10>` scales recording resolution from 50% through native resolution; omitting it keeps native/current resolution.
- Android supports the same core interaction set, plus `rotate`, `push` notification simulation, `clipboard read/write`, and `keyboard status|get|dismiss`.
- iOS `keyboard dismiss` is best-effort through the XCTest runner, including common native controls such as keyboard toolbar `Done`, and can fail when the app exposes no native dismiss gesture/control.
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
