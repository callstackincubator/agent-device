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
- `open --remote-config <path> --relaunch` is the recommended remote Metro-backed session flow. It prepares Metro locally when needed, forwards the effective runtime hints inline on `open`, and keeps the session launch state internal.
- Use `--session <name>` to run multiple sessions in parallel.

For replay scripts and deterministic E2E guidance, see [Replay & E2E (Experimental)](/agent-device/pr-preview/pr-318/docs/replay-e2e.md).
