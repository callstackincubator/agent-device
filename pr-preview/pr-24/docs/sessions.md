# Sessions

Sessions keep device state and snapshots consistent across commands.

```bash
agent-device open Settings --platform ios
agent-device session list
agent-device open Contacts          # change app while reusing the default session
agent-device close
```

Open another session independently (for parallel work):

```bash
agent-device open Contacts --platform ios --session my-session
agent-device snapshot -i
agent-device close --session my-session
```

Notes:

- `open <app>` within an existing session switches the active app and updates the session bundle id.
- Use `--session <name>` to run multiple sessions in parallel.

For replay scripts and deterministic E2E guidance, see [Replay & E2E (Experimental)](/agent-device/pr-preview/pr-24/docs/replay-e2e.md).
