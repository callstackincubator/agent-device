---
name: agent-device
description: Automates mobile and simulator interactions for iOS and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, pinching, or extracting UI info on mobile devices or simulators.
---

# Mobile Automation with agent-device

For agent-driven exploration: use refs. For deterministic replay scripts: use selectors.

## Quick start

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device click @e3
agent-device wait text "Camera"
agent-device alert wait 10000
agent-device fill @e5 "test"
agent-device close
```

If not installed, run:

```bash
npx -y agent-device
```

## Core workflow

1. Open app: `open [app]` (`open` handles target selection + boot/activation in the normal flow)
2. Snapshot: `snapshot` to get refs from accessibility tree
3. Interact using refs (`click @ref`, `fill @ref "text"`)
4. Re-snapshot after navigation/UI changes
5. Close session when done

## Commands

### Navigation

```bash
agent-device boot                 # Ensure target is booted/ready without opening app
agent-device boot --platform ios  # Boot iOS simulator
agent-device boot --platform android # Boot Android emulator/device target
agent-device open [app]           # Boot device/simulator; optionally launch app
agent-device open [app] --relaunch # Terminate app process first, then launch (fresh runtime)
agent-device open [app] --activity com.example/.MainActivity # Android: open specific activity
agent-device close [app]          # Close app or just end session
agent-device reinstall <app> <path> # Uninstall + install app in one command
agent-device session list         # List active sessions
```

`boot` requires either an active session or an explicit selector (`--platform`, `--device`, `--udid`, or `--serial`).
`boot` is a fallback, not a regular step: use it when starting a new session only if `open` cannot find/connect to an available target.

### Snapshot (page analysis)

```bash
agent-device snapshot                  # Full XCTest accessibility tree snapshot
agent-device snapshot -i               # Interactive elements only (recommended)
agent-device snapshot -c               # Compact output
agent-device snapshot -d 3             # Limit depth
agent-device snapshot -s "Camera"      # Scope to label/identifier
agent-device snapshot --raw            # Raw node output
agent-device snapshot --backend xctest # default: XCTest snapshot (fast, complete, no permissions)
agent-device snapshot --backend ax     # macOS Accessibility tree (fast, needs permissions, less fidelity, optional)
```

XCTest is the default: fast and complete and does not require permissions. Use it in most cases and only fall back to AX when something breaks.

### Find (semantic)

```bash
agent-device find "Sign In" click
agent-device find text "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find value "Search" type "query"
agent-device find role button click
agent-device find id "com.example:id/login" click
agent-device find "Settings" wait 10000
agent-device find "Settings" exists
```

### Settings helpers (simulators)

```bash
agent-device settings wifi on
agent-device settings wifi off
agent-device settings airplane on
agent-device settings airplane off
agent-device settings location on
agent-device settings location off
```

Note: iOS wifi/airplane toggles status bar indicators, not actual network state.
Airplane off clears status bar overrides.

### App state

```bash
agent-device appstate
agent-device apps --metadata --platform ios
agent-device apps --metadata --platform android
```

### Interactions (use @refs from snapshot)

```bash
agent-device click @e1
agent-device focus @e2
agent-device fill @e2 "text"           # Clear then type (Android: verifies value and retries once on mismatch)
agent-device type "text"               # Type into focused field without clearing
agent-device press 300 500             # Tap by coordinates
agent-device long-press 300 500 800    # Long press (where supported)
agent-device scroll down 0.5
agent-device pinch 2.0              # Zoom in 2x (iOS simulator + Android)
agent-device pinch 0.5 200 400     # Zoom out at coordinates
agent-device back
agent-device home
agent-device app-switcher
agent-device wait 1000
agent-device wait text "Settings"
agent-device is visible 'id="settings_anchor"'  # selector assertions for deterministic checks
agent-device is text 'id="header_title"' "Settings"
agent-device alert get
```

### Get information

```bash
agent-device get text @e1
agent-device get attrs @e1
agent-device screenshot out.png
```

### Deterministic replay and updating

```bash
agent-device open App --relaunch      # Fresh app process restart in the current session
agent-device open App --save-script   # Save session script (.ad) on close
agent-device replay ./session.ad      # Run deterministic replay from .ad script
agent-device replay -u ./session.ad   # Update selector drift and rewrite .ad script in place
```

`replay` reads `.ad` recordings.
`--relaunch` controls launch semantics; `--save-script` controls recording. Combine only when both are needed.

### Trace logs (AX/XCTest)

```bash
agent-device trace start               # Start trace capture
agent-device trace start ./trace.log   # Start trace capture to path
agent-device trace stop                # Stop trace capture
agent-device trace stop ./trace.log    # Stop and move trace log
```

### Devices and apps

```bash
agent-device devices
agent-device apps --platform ios
agent-device apps --platform android          # default: launchable only
agent-device apps --platform android --all
agent-device apps --platform android --user-installed
```

## Best practices

- Pinch (`pinch <scale> [x y]`) is supported on iOS simulators and Android; scale > 1 zooms in, < 1 zooms out. On Android, pinch uses multi-touch `sendevent` injection.
- Snapshot refs are the core mechanism for interactive agent flows.
- Use selectors for deterministic replay artifacts and assertions (e.g. in e2e test workflows).
- Prefer `snapshot -i` to reduce output size.
- On iOS, `xctest` is the default and does not require Accessibility permission.
- If XCTest returns 0 nodes (foreground app changed), agent-device falls back to AX when available.
- `open <app>` can be used within an existing session to switch apps and update the session bundle id.
- Use `open <app> --relaunch` during React Native/Fast Refresh debugging when you need a fresh app process without ending the session.
- If AX returns the Simulator window or empty tree, restart Simulator or use `--backend xctest`.
- Use `--session <name>` for parallel sessions; avoid device contention.
- Use `--activity <component>` on Android to launch a specific activity (e.g. TV apps with LEANBACK).
- Use `fill` when you want clear-then-type semantics.
- Use `type` when you want to append/enter text without clearing.
- On Android, prefer `fill` for important fields; it verifies entered text and retries once when IME reorders characters.
- If using deterministic replay scripts, use `replay -u` during maintenance runs to update selector drift in replay scripts. Use plain `replay` in CI.

## References

- [references/snapshot-refs.md](references/snapshot-refs.md)
- [references/session-management.md](references/session-management.md)
- [references/permissions.md](references/permissions.md)
- [references/video-recording.md](references/video-recording.md)
- [references/coordinate-system.md](references/coordinate-system.md)
