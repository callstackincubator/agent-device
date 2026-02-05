---
title: Sessions
---

# Sessions

Sessions keep device state and snapshots consistent across commands.

```bash
agent-device open Settings --platform ios
agent-device session list
agent-device open Contacts --session default
agent-device close
```

Notes:

- `open <app>` within an existing session switches the active app and updates the session bundle id.
- Use `--session <name>` to run multiple sessions in parallel.
