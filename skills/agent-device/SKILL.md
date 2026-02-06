---
name: agent-device
description: Automates mobile and simulator interactions for iOS and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, pinching, or extracting UI info on mobile devices or simulators.
---

# Mobile Automation with agent-device

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

1. Open app or just boot device: `open [app]`
2. Snapshot: `snapshot` to get full XCTest accessibility tree snapshot
3. Interact using refs (`click @ref`, `fill @ref "text"`)
4. Re-snapshot after navigation or UI changes
5. Close session when done

## Commands

### Navigation

```bash
agent-device open [app]           # Boot device/simulator; optionally launch app
agent-device open [app] --activity com.example/.MainActivity # Android: open specific activity
agent-device close [app]          # Close app or just end session
agent-device session list         # List active sessions
```

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
agent-device alert get
```

### Get information

```bash
agent-device get text @e1
agent-device get attrs @e1
agent-device screenshot out.png
```

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
- Always snapshot right before interactions; refs invalidate on UI changes.
- Prefer `snapshot -i` to reduce output size.
- On iOS, `xctest` is the default and does not require Accessibility permission.
- If XCTest returns 0 nodes (foreground app changed), agent-device falls back to AX when available.
- `open <app>` can be used within an existing session to switch apps and update the session bundle id.
- If AX returns the Simulator window or empty tree, restart Simulator or use `--backend xctest`.
- Use `--session <name>` for parallel sessions; avoid device contention.
- Use `--activity <component>` on Android to launch a specific activity (e.g. TV apps with LEANBACK).
- Use `fill` when you want clear-then-type semantics.
- Use `type` when you want to append/enter text without clearing.
- On Android, prefer `fill` for important fields; it verifies entered text and retries once when IME reorders characters.

## References

- [references/snapshot-refs.md](references/snapshot-refs.md)
- [references/session-management.md](references/session-management.md)
- [references/permissions.md](references/permissions.md)
- [references/video-recording.md](references/video-recording.md)
- [references/coordinate-system.md](references/coordinate-system.md)
