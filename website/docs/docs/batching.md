---
title: Batching
---

# Batching

Use `batch` to run multiple commands in a single daemon request.

This is useful for agent workflows that already know the next sequence of actions and want to reduce orchestration overhead.

## CLI examples

From a file:

```bash
agent-device batch \
  --session sim \
  --platform ios \
  --udid 00008150-001849640CF8401C \
  --steps-file /tmp/batch-steps.json \
  --json
```

Inline for small payloads:

```bash
agent-device batch --steps '[{"command":"open","positionals":["settings"]},{"command":"wait","positionals":["100"]}]'
```

## Step payload format

`batch` accepts a JSON array of steps:

```json
[
  { "command": "open", "positionals": ["settings"], "flags": {} },
  { "command": "wait", "positionals": ["label=\"Privacy & Security\"", "3000"], "flags": {} },
  { "command": "click", "positionals": ["label=\"Privacy & Security\""], "flags": {} },
  { "command": "get", "positionals": ["text", "label=\"Tracking\""], "flags": {} }
]
```

Notes:

- `positionals` is optional (defaults to `[]`).
- `flags` is optional (defaults to `{}`).
- nested `batch` and `replay` steps are rejected.
- `--on-error stop` is the supported behavior.

## Response shape

Success:

```json
{
  "success": true,
  "data": {
    "total": 4,
    "executed": 4,
    "totalDurationMs": 1810,
    "results": [
      { "step": 1, "command": "open", "ok": true, "durationMs": 1020 },
      { "step": 2, "command": "wait", "ok": true, "durationMs": 320 },
      { "step": 3, "command": "click", "ok": true, "durationMs": 260 },
      { "step": 4, "command": "get", "ok": true, "durationMs": 210, "data": { "text": "..." } }
    ]
  }
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "COMMAND_FAILED",
    "message": "Batch failed at step 3 (click): ...",
    "details": {
      "step": 3,
      "command": "click",
      "positionals": ["label=\"Privacy & Security\""],
      "executed": 2,
      "total": 4,
      "partialResults": [
        { "step": 1, "command": "open", "ok": true },
        { "step": 2, "command": "wait", "ok": true }
      ]
    }
  }
}
```

## Agent best practices

- Batch only one related screen flow at a time.
- After mutating steps (`open`, `click`, `fill`, `swipe`), add a sync guard (`wait`, `is exists`) before critical reads.
- Treat prior refs/snapshots as stale after UI changes.
- Prefer `--steps-file` over inline JSON.
- Keep batches moderate (about 5-20 steps).
- Replan from the failing step using `details.step` and `details.partialResults`.

## Stale accessibility tree risk

Rapid UI changes can outpace accessibility tree updates. Mitigate by inserting explicit waits and splitting long workflows into phases:

1. navigate
2. verify/extract
3. cleanup
