---
title: Snapshots
---

# Snapshots

Snapshots provide a structured view of the UI and generate stable refs.

```bash
agent-device snapshot -i
agent-device snapshot --backend xctest
agent-device snapshot --backend ax
```

Backends:

- `xctest` (default): full fidelity, no Accessibility permission required.
- `ax`: fast accessibility tree, may miss details.

Tips:

- Use `-i` for interactive-only output.
- Use `-c` to compact structural noise.
- Use `-d <depth>` to limit depth.
- If XCTest returns 0 nodes (foreground app changed), agent-device falls back to AX when available.
