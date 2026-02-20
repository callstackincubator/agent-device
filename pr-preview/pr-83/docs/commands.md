# Commands

This page summarizes the primary command groups.

## Navigation

```bash
agent-device boot
agent-device boot --platform ios
agent-device boot --platform android
agent-device open [app|url] [url]
agent-device close [app]
agent-device back
agent-device home
agent-device app-switcher
```

- `boot` ensures the selected target is ready without launching an app.
- `boot` requires either an active session or an explicit device selector.
- `boot` is mainly needed when starting a new session and `open` fails because no booted simulator/emulator is available.
- `open [app|url] [url]` already boots/activates the selected target when needed.
- `open <url>` deep links are supported on Android and iOS.
- `open <app> <url>` opens a deep link on iOS.
- On iOS devices, `http(s)://` URLs open in Safari when no app is active. Custom scheme URLs require an active app in the session.

```bash
agent-device open "https://example.com" --platform ios           # open link in web browser
agent-device open MyApp "myapp://screen/to" --platform ios       # open deep link to MyApp
```

## Snapshot and inspect

```bash
agent-device snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw]
agent-device get text @e1
agent-device get attrs @e1
```

- iOS snapshots use XCTest on simulators and physical devices.

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
agent-device longpress 300 500 800
agent-device scroll down 0.5
agent-device pinch 2.0          # zoom in 2x (iOS simulator)
agent-device pinch 0.5 200 400 # zoom out at coordinates (iOS simulator)
```

`fill` clears then types. `type` does not clear.
On Android, `fill` also verifies text and performs one clear-and-retry pass on mismatch.
`swipe` accepts an optional `durationMs` argument (default `250ms`, range `16..10000`).
On iOS, swipe timing uses a safe normalized duration to avoid longpress side effects.
`longpress` is supported on iOS and Android.
`pinch` is iOS simulator-only.

## Find (semantic)

```bash
agent-device find "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find role button click
```

## Replay

```bash
agent-device open Settings --platform ios --session e2e --save-script [path]
agent-device replay ./session.ad      # Run deterministic replay from .ad script
agent-device replay -u ./session.ad   # Update selector drift and rewrite .ad script in place
```

- `replay` runs deterministic `.ad` scripts.
- `replay -u` updates stale recorded actions and rewrites the same script.
- `--save-script` records a replay script on `close`; optional path is a file path and parent directories are created.

See [Replay & E2E (Experimental)](/agent-device/pr-preview/pr-83/docs/replay-e2e.md) for recording and CI workflow details.

## Batch

```bash
agent-device batch --steps-file /tmp/batch-steps.json --json
agent-device batch --steps '[{"command":"open","positionals":["settings"]}]'
```

- `batch` runs a JSON array of steps in a single daemon request.
- each step has `command`, optional `positionals`, and optional `flags`.
- stop-on-first-error is the supported behavior (`--on-error stop`).
- use `--max-steps <n>` to tighten per-request safety limits.

See [Batching](/agent-device/pr-preview/pr-83/docs/batching.md) for payload format, response shape, and usage guidelines.

## App reinstall (fresh state)

```bash
agent-device reinstall com.example.app ./build/app.apk --platform android
agent-device reinstall com.example.app ./build/MyApp.app --platform ios
```

- `reinstall <app> <path>` uninstalls and installs in one command.
- Supports Android devices/emulators and iOS simulators.
- Useful for login/logout reset flows and deterministic test setup.

## Settings helpers

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

- iOS `settings` support is simulator-only.
- Face ID controls are iOS simulator-only.
- Use `match`/`nonmatch` to simulate valid/invalid Face ID outcomes.

## App state and app lists

```bash
agent-device appstate
agent-device apps --platform ios
agent-device apps --platform ios --all
agent-device apps --platform android
agent-device apps --platform android --all
```

- Android `appstate` reports live foreground package/activity.
- iOS `appstate` is session-scoped and reports the app tracked by the active session on the target device.
- `apps` includes default/system apps by default (use `--user-installed` to filter).

## Media and logs

```bash
agent-device screenshot                 # Auto filename
agent-device screenshot page.png        # Explicit screenshot path
agent-device record start               # Start screen recording to auto filename
agent-device record start session.mp4   # Start recording to explicit path
agent-device record stop                # Stop active recording
```

- iOS `record` works on simulators and physical devices. Physical-device capture is runner-based and may have lower FPS than simulator-native recording.

## iOS device prerequisites

- Xcode + `xcrun devicectl` available.
- Paired physical device with Developer Mode enabled.
- Use Automatic Signing in Xcode, or pass optional env overrides:
  - `AGENT_DEVICE_IOS_TEAM_ID`
  - `AGENT_DEVICE_IOS_SIGNING_IDENTITY` (optional)
  - `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`
- If first-run XCTest setup/build is slow, increase daemon request timeout:
  - `AGENT_DEVICE_DAEMON_TIMEOUT_MS=120000` (default is `90000`)
- For daemon startup troubleshooting:
  - follow stale metadata hints for `~/.agent-device/daemon.json` and `~/.agent-device/daemon.lock`
