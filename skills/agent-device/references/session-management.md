# Session Management

## Named sessions

```bash
agent-device --session auth open Settings --platform ios
agent-device --session auth snapshot -i
```

Sessions isolate device context. A device can only be held by one session at a time.

## Best practices

- Name sessions semantically.
- Close sessions when done.
- Use separate sessions for parallel work.
- In iOS sessions, use `open <app>` for simulator/device. `open <url>` is simulator-only.
- For dev loops where runtime state can persist (for example React Native Fast Refresh), use `open <app> --relaunch` to restart the app process in the same session.
- For deterministic replay scripts, prefer selector-based actions and assertions.
- Use `replay -u` to update selector drift during maintenance.

## Listing sessions

```bash
agent-device session list
```

## Replay within sessions

```bash
agent-device replay ./session.ad --session auth
agent-device replay -u ./session.ad --session auth
```
