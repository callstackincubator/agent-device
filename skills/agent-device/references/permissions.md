# Permissions and Setup

## iOS snapshots

iOS snapshots use XCTest and do not require macOS Accessibility permissions.

## iOS physical device runner

For iOS physical devices, XCTest runner setup requires valid signing/provisioning.
Use Automatic Signing in Xcode, or provide optional overrides:

- `AGENT_DEVICE_IOS_TEAM_ID`
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY`
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`

If first-run setup/build takes long, increase:

- `AGENT_DEVICE_DAEMON_TIMEOUT_MS` (for example `180000`)

## Simulator troubleshooting

- If snapshots return 0 nodes, restart Simulator and re-open the app.
