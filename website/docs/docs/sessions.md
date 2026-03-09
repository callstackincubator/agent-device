---
title: Sessions
---

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

Shut down the simulator on close (iOS simulator only, prevents resource leakage in CI/multi-tenant workloads):

```bash
agent-device close --platform ios --shutdown
```

Notes:

- `open <app>` within an existing session switches the active app and updates the session bundle id.
- `open <url>` in iOS sessions opens deep links.
- `open <app> <url>` in iOS sessions opens deep links.
- On iOS devices, `http(s)://` URLs open in Safari when no app is active. Custom scheme URLs require an active app in the session.
- On iOS, `appstate` is session-scoped and requires a matching active session on the target device.
- `runtime set|show|clear` stores session-scoped runtime hints independently of `open`, so remote daemon flows can set Metro/debug details before the first launch. Android sessions apply those hints to React Native dev prefs, and iOS simulator sessions apply them to app defaults before launch.
- Use `--session <name>` to run multiple sessions in parallel.

For replay scripts and deterministic E2E guidance, see [Replay & E2E (Experimental)](/docs/replay-e2e).
