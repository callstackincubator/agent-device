# Permissions and Setup

## iOS snapshots

iOS snapshots use XCTest and do not require macOS Accessibility permissions.

## iOS physical device runner

For iOS physical devices, XCTest runner setup requires valid signing/provisioning.
Use Automatic Signing in Xcode, or provide optional overrides:

- `AGENT_DEVICE_IOS_TEAM_ID`
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY`
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`

If setup/build takes long, increase:

- `AGENT_DEVICE_DAEMON_TIMEOUT_MS` (default `45000`, for example `120000`)

If daemon startup fails with stale metadata hints, clean stale files and retry:

- `~/.agent-device/daemon.json`
- `~/.agent-device/daemon.lock`

## iOS: "Allow Paste" dialog

iOS 16+ shows an "Allow Paste" prompt when an app reads the system pasteboard. Under XCUITest (which `agent-device` uses), this prompt is suppressed by the testing runtime. Use `xcrun simctl pbcopy booted` to set clipboard content directly on the simulator instead.

## Simulator troubleshooting

- If snapshots return 0 nodes, restart Simulator and re-open the app.
