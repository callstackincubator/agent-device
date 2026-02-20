---
title: Introduction
---

# Introduction

`agent-device` is a CLI for automating iOS simulators + physical devices and Android emulators + devices from agents. It provides:

- Accessibility snapshots for UI understanding
- Deterministic interactions (tap, type, scroll)
- Session-aware workflows and replay

If you know `agent-browser`, this is the mobile-native counterpart for iOS/Android UI automation.

## What it’s good at

- Capturing structured UI state for LLMs
- Driving common UI actions with refs or semantic selectors
- Replaying flows for regression checks

## Platform support highlights

- iOS core runner commands: `snapshot`, `wait`, `click`, `fill`, `get`, `is`, `find`, `press`, `longpress`, `focus`, `type`, `scroll`, `scrollintoview`, `back`, `home`, `app-switcher`, `open` (app), `close`, `screenshot`, `apps`, `appstate`.
- iOS `appstate` is session-scoped on the selected target device.
- iOS simulator-only: `alert`, `pinch`, `reinstall`, `settings`.
- iOS `record` supports simulators and physical devices (runner-based on devices, 60 FPS default, configurable via `--fps`).
- Android support remains unchanged.

## Architecture (high level)

1. CLI sends requests to the daemon.
2. The daemon manages sessions and dispatches to platform drivers.
3. iOS uses XCTest runner for snapshots and input on simulators and physical devices.
4. Android uses ADB-based tooling.

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
agent-device fill @e5 "Doe 2"
agent-device close
```
