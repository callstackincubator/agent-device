# Permissions and Setup

## iOS AX snapshot

Hybrid snapshot (default) is recommended for best speed vs correctness; it uses macOS Accessibility APIs and requires permission:

System Settings > Privacy & Security > Accessibility

If permission is missing, use:

```bash
agent-device snapshot --backend xctest --platform ios
```

Hybrid/AX is fast; XCTest is slower but does not require permissions.

## Simulator troubleshooting

- If AX shows the Simulator chrome instead of app, restart Simulator.
- If AX returns empty, restart Simulator and re-open app.
