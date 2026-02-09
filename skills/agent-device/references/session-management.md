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
