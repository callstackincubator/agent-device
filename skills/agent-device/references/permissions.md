# Permissions and Setup

## iOS AX snapshot

AX snapshot is an alternative to XCTest for when it fails (which shouldn't happen usually); it uses macOS Accessibility APIs and requires permission:

System Settings > Privacy & Security > Accessibility

If permission is missing, use XCTest backend:

```bash
agent-device snapshot --backend xctest --platform ios
```

Hybrid/AX is fast; XCTest is equally fast but does not require permissions.

## Simulator troubleshooting

- If AX shows the Simulator chrome instead of app, restart Simulator.
- If AX returns empty, restart Simulator and re-open app.
