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

Shut down the simulator/emulator on close (iOS simulators and Android emulators, prevents resource leakage in CI/multi-tenant workloads):

```bash
agent-device close --shutdown
```

Notes:

- `open <app>` within an existing session switches the active app and updates the session bundle id.
- `open <url>` in iOS sessions opens deep links.
- `open <app> <url>` in iOS sessions opens deep links.
- On iOS devices, `http(s)://` URLs open in Safari when no app is active. Custom scheme URLs require an active app in the session.
- On iOS, `appstate` is session-scoped and requires a matching active session on the target device.
- For remote `connect --remote-config` sessions, see [Commands](/docs/commands#remote-metro-workflow).
- Use `--session <name>` to run multiple sessions in parallel. Do not parallelize mutating commands against the same session; serialize stateful actions such as open, press, fill, type, scroll, back, alert, replay, batch, and close.

For replay scripts and deterministic E2E guidance, see [Replay & E2E (Experimental)](/docs/replay-e2e).
