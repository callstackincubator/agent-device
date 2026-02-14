---
title: Commands
---

# Commands

This page summarizes the primary command groups.

## Navigation

```bash
agent-device boot
agent-device boot --platform ios
agent-device boot --platform android
agent-device open [app]
agent-device close [app]
agent-device back
agent-device home
agent-device app-switcher
```

- `boot` ensures the selected target is ready without launching an app.
- `boot` requires either an active session or an explicit device selector.
- `boot` is mainly needed when starting a new session and `open` fails because no booted simulator/emulator is available.
- `open [app]` already boots/activates the selected target when needed.

## Snapshot and inspect

```bash
agent-device snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--backend ax|xctest]
agent-device get text @e1
agent-device get attrs @e1
```

## Interactions

```bash
agent-device click @e1
agent-device focus @e2
agent-device fill @e2 "text"          # Clear then type
agent-device type "text"              # Type into focused field without clearing
agent-device press 300 500
agent-device press 300 500 --count 12 --interval-ms 45
agent-device press 300 500 --count 6 --hold-ms 120 --interval-ms 30 --jitter-px 2
agent-device swipe 540 1500 540 500 120
agent-device swipe 540 1500 540 500 120 --count 8 --pause-ms 30 --pattern ping-pong
agent-device long-press 300 500 800
agent-device scroll down 0.5
agent-device pinch 2.0          # zoom in 2x (iOS simulator)
agent-device pinch 0.5 200 400 # zoom out at coordinates (iOS simulator)
```

`fill` clears then types. `type` does not clear.
On Android, `fill` also verifies text and performs one clear-and-retry pass on mismatch.
`swipe` accepts an optional `durationMs` argument (default `250ms`, range `16..10000`).
On iOS, swipe timing uses a safe normalized duration to avoid long-press side effects.
`pinch` is iOS-simulator-only in the current adb-backed Android implementation.

## Find (semantic)

```bash
agent-device find "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find role button click
```

## Replay

```bash
agent-device replay ./session.ad      # Run deterministic replay from .ad script
agent-device replay -u ./session.ad   # Update selector drift and rewrite .ad script in place
```

- `replay` runs deterministic `.ad` scripts.
- `replay -u` updates stale recorded actions and rewrites the same script.

See [Replay & E2E (Experimental)](/docs/replay-e2e) for recording and CI workflow details.

## App reinstall (fresh state)

```bash
agent-device reinstall com.example.app ./build/app.apk --platform android
agent-device reinstall com.example.app ./build/MyApp.app --platform ios
```

- `reinstall <app> <path>` uninstalls and installs in one command.
- Supports Android devices/emulators and iOS simulators in v1.
- Useful for login/logout reset flows and deterministic test setup.

## Settings helpers

```bash
agent-device settings wifi on
agent-device settings wifi off
agent-device settings airplane on
agent-device settings airplane off
agent-device settings location on
agent-device settings location off
```

## Media and logs

```bash
agent-device screenshot                 # Auto filename
agent-device screenshot page.png        # Explicit screenshot path
agent-device record start               # Start screen recording to auto filename
agent-device record start session.mp4   # Start recording to explicit path
agent-device record stop                # Stop active recording
```
