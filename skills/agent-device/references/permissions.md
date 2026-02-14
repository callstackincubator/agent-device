# Permissions and Setup

## iOS AX snapshot

AX snapshot is an alternative to XCTest for when it fails (which shouldn't happen usually); it uses macOS Accessibility APIs and requires permission:

System Settings > Privacy & Security > Accessibility

If permission is missing, use XCTest backend:

```bash
agent-device snapshot --backend xctest --platform ios
```

Hybrid/AX is fast; XCTest is equally fast but does not require permissions.
AX backend is simulator-only.

## iOS physical device runner

For iOS physical devices, XCTest runner setup requires valid signing/provisioning.
Use Automatic Signing in Xcode, or provide optional overrides:

- `AGENT_DEVICE_IOS_TEAM_ID`
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY`
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`

If first-run setup/build takes long, increase:

- `AGENT_DEVICE_DAEMON_TIMEOUT_MS` (for example `180000`)

## Simulator troubleshooting

- If AX shows the Simulator chrome instead of app, restart Simulator.
- If AX returns empty, restart Simulator and re-open app.
