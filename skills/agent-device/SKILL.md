---
name: agent-device
description: Automates interactions for iOS simulators/devices and Android emulators/devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info on mobile targets.
---

# Mobile Automation with agent-device

For agent-driven exploration: use refs. For deterministic replay scripts: use selectors.

## Quick start

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e3
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

1. Open app or deep link: `open [app|url] [url]` (`open` handles target selection + boot/activation in the normal flow)
2. Snapshot: `snapshot` to get refs from accessibility tree
3. Interact using refs (`press @ref`, `fill @ref "text"`; `click` is an alias of `press`, `dblclick` is an alias of `click --double-tap`)
4. Re-snapshot after navigation/UI changes
5. Close session when done

## Commands

### Navigation

```bash
agent-device boot                 # Ensure target is booted/ready without opening app
agent-device boot --platform ios  # Boot iOS target
agent-device boot --platform android # Boot Android emulator/device target
agent-device open [app|url] [url] # Boot device/simulator; optionally launch app or deep link URL
agent-device open [app] --relaunch # Terminate app process first, then launch (fresh runtime)
agent-device open [app] --activity com.example/.MainActivity # Android: open specific activity (app targets only)
agent-device open "myapp://home" --platform android          # Android deep link
agent-device open "https://example.com" --platform ios       # iOS deep link (opens in browser)
agent-device open MyApp "myapp://screen/to" --platform ios   # iOS deep link in app context
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
```

XCTest is the iOS snapshot engine: fast, complete, and no Accessibility permission required.

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

### Settings helpers

```bash
agent-device settings wifi on
agent-device settings wifi off
agent-device settings airplane on
agent-device settings airplane off
agent-device settings location on
agent-device settings location off
agent-device settings faceid match
agent-device settings faceid nonmatch
agent-device settings faceid enroll
agent-device settings faceid unenroll
```

Note: iOS wifi/airplane toggles status bar indicators, not actual network state.
Airplane off clears status bar overrides.
iOS settings helpers are simulator-only.
Use `match`/`nonmatch` as the canonical command values.
Think of them as validate/invalidate outcomes when describing intent.

### App state

```bash
agent-device appstate
```

- Android: `appstate` reports live foreground package/activity.
- iOS: `appstate` is session-scoped and reports the app tracked by the active session on the target device.
- For iOS `appstate`, ensure a matching session exists (for example `open --session <name> --platform ios --device "<name>" <app>`).

### Interactions (use @refs from snapshot)

```bash
agent-device press @e1                # Canonical tap command (`click` is an alias, `dblclick` is a double-tap alias)
agent-device dblclick @e1             # Equivalent to: click @e1 --double-tap
agent-device focus @e2
agent-device fill @e2 "text"           # Clear then type (Android: verifies value and retries once on mismatch)
agent-device type "text"               # Type into focused field without clearing
agent-device press 300 500             # Tap by coordinates
agent-device press 300 500 --count 12 --interval-ms 45
agent-device press 300 500 --count 6 --hold-ms 120 --interval-ms 30 --jitter-px 2
agent-device press @e1 --count 5             # Repeat taps on the same target
agent-device press @e1 --count 5 --double-tap # Use double-tap gesture per iteration
agent-device swipe 540 1500 540 500 120
agent-device swipe 540 1500 540 500 120 --count 8 --pause-ms 30 --pattern ping-pong
agent-device long-press 300 500 800    # Long press (where supported)
agent-device scroll down 0.5
agent-device pinch 2.0              # Zoom in 2x (iOS simulator only)
agent-device pinch 0.5 200 400     # Zoom out at coordinates (iOS simulator only)
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
agent-device open App --save-script   # Save session script (.ad) on close (default path)
agent-device open App --save-script ./workflows/app-flow.ad  # Save to custom file path
agent-device replay ./session.ad      # Run deterministic replay from .ad script
agent-device replay -u ./session.ad   # Update selector drift and rewrite .ad script in place
```

`replay` reads `.ad` recordings.
`--relaunch` controls launch semantics; `--save-script` controls recording. Combine only when both are needed.
`--save-script` path is a file path; parent directories are created automatically.
For ambiguous bare values, use `--save-script=workflow.ad` or `./workflow.ad`.

### Fast batching (JSON steps)

Use `batch` when an agent already has a known short sequence and wants fewer orchestration round trips.

```bash
agent-device batch \
  --session sim \
  --platform ios \
  --udid 00008150-001849640CF8401C \
  --steps-file /tmp/batch-steps.json \
  --json
```

Inline JSON works for small payloads:

```bash
agent-device batch --steps '[{"command":"open","positionals":["settings"]},{"command":"wait","positionals":["100"]}]'
```

Step format:

```json
[
  { "command": "open", "positionals": ["settings"], "flags": {} },
  { "command": "wait", "positionals": ["label=\"Privacy & Security\"", "3000"], "flags": {} },
  { "command": "click", "positionals": ["label=\"Privacy & Security\""], "flags": {} },
  { "command": "get", "positionals": ["text", "label=\"Tracking\""], "flags": {} }
]
```

Batch best practices:

- Batch one screen-local flow at a time.
- Add sync guards (`wait`, `is exists`) after mutating steps (`open`, `click`, `fill`, `swipe`).
- Treat prior refs/snapshot assumptions as stale after UI mutations.
- Prefer `--steps-file` over inline JSON.
- Keep batches moderate (about 5-20 steps).
- Use failure context (`step`, `partialResults`) to replan from the failed step.

Stale accessibility tree note:

- Rapid mutations can outrun accessibility tree updates.
- Mitigate with explicit waits and phase splitting (navigate, verify/extract, cleanup).

### Trace logs (XCTest)

```bash
agent-device trace start               # Start trace capture
agent-device trace start ./trace.log   # Start trace capture to path
agent-device trace stop                # Stop trace capture
agent-device trace stop ./trace.log    # Stop and move trace log
```

### Devices and apps

```bash
agent-device devices
agent-device apps --platform ios              # iOS simulator + iOS device, includes default/system apps
agent-device apps --platform ios --all        # explicit include-all (same as default)
agent-device apps --platform ios --user-installed
agent-device apps --platform android          # includes default/system apps
agent-device apps --platform android --all    # explicit include-all (same as default)
agent-device apps --platform android --user-installed
```

## Best practices

- `press` is the canonical tap command; `click` is an alias with the same behavior; `dblclick` is shorthand for `click --double-tap`.
- `press`, `click`, and `dblclick` accept `x y`, `@ref`, and selector targets.
- `press`/`click`/`dblclick` support gesture series controls: `--count`, `--interval-ms`, `--hold-ms`, `--jitter-px`, `--double-tap`.
- `--double-tap` cannot be combined with `--hold-ms` or `--jitter-px`.
- `swipe` supports coordinate + timing controls and repeat patterns: `swipe x1 y1 x2 y2 [durationMs] --count --pause-ms --pattern`.
- `swipe` timing is platform-safe: Android uses requested duration; iOS uses normalized safe timing to avoid long-press side effects.
- Pinch (`pinch <scale> [x y]`) is iOS simulator-only; scale > 1 zooms in, < 1 zooms out.
- Snapshot refs are the core mechanism for interactive agent flows.
- Use selectors for deterministic replay artifacts and assertions (e.g. in e2e test workflows).
- Prefer `snapshot -i` to reduce output size.
- On iOS, snapshots use XCTest and do not require Accessibility permission.
- If XCTest returns 0 nodes (foreground app changed), treat it as an explicit failure and retry the flow/app state.
- `open <app|url> [url]` can be used within an existing session to switch apps or open deep links.
- `open <app>` updates session app bundle context; `open <app> <url>` opens a deep link on iOS.
- Use `open <app> --relaunch` during React Native/Fast Refresh debugging when you need a fresh app process without ending the session.
- Use `--session <name>` for parallel sessions; avoid device contention.
- Use `--activity <component>` on Android to launch a specific activity (e.g. TV apps with LEANBACK); do not combine with URL opens.
- On iOS devices, `http(s)://` URLs fall back to Safari automatically; custom scheme URLs require an active app in the session.
- iOS physical-device runner requires Xcode signing/provisioning; optional overrides: `AGENT_DEVICE_IOS_TEAM_ID`, `AGENT_DEVICE_IOS_SIGNING_IDENTITY`, `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`.
- Default daemon request timeout is `45000`ms. For slow physical-device setup/build, increase `AGENT_DEVICE_DAEMON_TIMEOUT_MS` (for example `120000`).
- For daemon startup troubleshooting, follow stale metadata hints for `~/.agent-device/daemon.json` / `~/.agent-device/daemon.lock`.
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
- [references/batching.md](references/batching.md)
