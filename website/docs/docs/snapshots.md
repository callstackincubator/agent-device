---
title: Snapshots
---

# Snapshots

Snapshots provide a structured view of the UI and generate stable refs.

```bash
agent-device snapshot                    # Full accessibility tree
agent-device snapshot -i                 # Interactive elements only (recommended)
agent-device snapshot -c                 # Compact (remove empty elements)
agent-device snapshot -d 3               # Limit depth to 3 levels
agent-device snapshot -s "Contacts"      # Scope to label/identifier
agent-device snapshot -i -c -d 5         # Combine options
```

| Option       | Description               |
| ------------ | ------------------------- |
| `-i`         | Interactive-only output   |
| `-c`         | Compact structural noise  |
| `-d <depth>` | Limit tree depth          |
| `-s <scope>` | Scope to label/identifier |

Note: If XCTest returns 0 nodes (foreground app changed), agent-device falls back to AX when available.

## Example output:

```bash
agent-device snapshot -i
# Output:
# Snapshot: 44 nodes
# @e1 [application] "Contacts"
#   @e2 [window]
#     @e3 [other]
#   @e4 [other] "Lists"
#     @e5 [navigation-bar] "Lists"
#       @e6 [button] "Lists"
#       @e7 [text] "Contacts"
#     @e8 [other] "John Doe"
#       @e9 [other] "John Doe"
```

## Backends (iOS):

- `xctest` (default): full fidelity, fast, no Accessibility permission required.
- `ax`: fast accessibility tree, may miss details, requires Accessibility permission.
