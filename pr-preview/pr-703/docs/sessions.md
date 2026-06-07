# Sessions

Sessions keep device state and snapshots consistent across commands.

```bash
agent-device open Settings --platform ios
agent-device session list
agent-device open Contacts          # change app in this workspace's default session
agent-device close
```

The implicit `default` session is scoped to the caller's git worktree or current working directory.
Independent agents in different worktrees do not attach to each other's default session.
When a session is established, human output includes a `Session state: <path>` line and JSON output includes `sessionStateDir`; this is the per-session artifact directory that can be inspected or removed after the run.

Open an explicitly named session only when you intentionally want a shared/reusable handle:

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
- For remote `connect --remote-config` sessions, see [Commands](/agent-device/pr-preview/pr-703/docs/commands.md#remote-metro-workflow).
- Use `--session <name>` for intentional named-session sharing. Do not parallelize mutating commands against the same session; serialize stateful actions such as open, press, fill, type, scroll, back, alert, replay, batch, and close.

For replay scripts and deterministic E2E guidance, see [Replay & E2E](/agent-device/pr-preview/pr-703/docs/replay-e2e.md).
