---
name: agent-device
description: Automates mobile and simulator interactions for iOS and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info on mobile devices or simulators.
---

# Mobile Automation with agent-device

## Quick start

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device snapshot -s @e3
agent-device click @e3
agent-device wait text "Camera"
agent-device alert wait 10000
agent-device fill @e5 "test"
agent-device close
```

## Core workflow

1. Open app or just boot device: `open [app]`
2. Snapshot: `snapshot -i` to get compact refs
3. Interact using refs (`click @eN`, `fill @eN "text"`)
4. Re-snapshot after navigation or UI changes
5. Close session when done

## Commands

### Navigation

```bash
agent-device open [app]           # Boot device/simulator; optionally launch app
agent-device close [app]          # Close app or just end session
agent-device session list         # List active sessions
```

### Snapshot (page analysis)

```bash
agent-device snapshot                 # Full accessibility tree
agent-device snapshot -i              # Interactive elements only (recommended)
agent-device snapshot -c              # Compact output
agent-device snapshot -d 3            # Limit depth
agent-device snapshot -s "Camera"      # Scope to label/identifier
agent-device snapshot --raw           # Raw node output
agent-device snapshot --backend hybrid # Default: best speed vs correctness trade-off (AX fast, XCTest complete)
agent-device snapshot --backend ax    # macOS Accessibility tree (fast, needs permissions)
agent-device snapshot --backend xctest # XCTest snapshot (slow, no permissions)
```

Hybrid will automatically fill empty containers (e.g. `group`, `tab bar`) by scoping XCTest to the container label.
It is recommended because AX is fast but can miss UI details, while XCTest is slower but more complete.
If you want explicit control or AX is unavailable, use `--backend xctest`.
In practice, if AX returns a `Tab Bar` group with no children, hybrid will run a scoped XCTest snapshot for `Tab Bar` and insert those nodes under the group.

### Interactions (use @refs from snapshot)

```bash
agent-device click @e1
agent-device focus @e2
agent-device fill @e2 "text"           # Tap then type
agent-device type "text"               # Type into focused field
agent-device press 300 500             # Tap by coordinates
agent-device long-press 300 500 800    # Long press (where supported)
agent-device scroll down 0.5
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
agent-device screenshot --out out.png
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

- Always snapshot right before interactions; refs invalidate on UI changes.
- Prefer `snapshot -i` to reduce output size.
- On iOS, hybrid is the default and uses AX first, so Accessibility permission is still required.
- If AX returns the Simulator window or empty tree, restart Simulator or use `--backend xctest`.
- Use `--session <name>` for parallel sessions; avoid device contention.

## References

- [references/snapshot-refs.md](references/snapshot-refs.md)
- [references/session-management.md](references/session-management.md)
- [references/permissions.md](references/permissions.md)
- [references/recording.md](references/recording.md)
- [references/coordinate-system.md](references/coordinate-system.md)

## Missing features roadmap (high level)

See [references/missing-features.md](references/missing-features.md) for planned parity with agent-browser.
