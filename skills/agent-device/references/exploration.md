# Exploration

## When to open this file

Open this file when the app or screen is already running and you need to discover the UI, choose targets, read state, wait for conditions, or perform normal interactions.

## Main commands to reach for first

- `snapshot`
- `snapshot -i`
- `press`
- `fill`
- `get`
- `is`
- `wait`
- `find`

## Most common mistake to avoid

Do not treat `@ref` values as durable after navigation or dynamic updates. Re-snapshot after the UI changes, and switch to selectors when the flow must stay stable.

## Canonical loop

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device wait visible 'label="Privacy & Security"' 3000
agent-device get text 'label="Privacy & Security"'
agent-device close
```

## Snapshot choices

- Use plain `snapshot` when you only need to verify whether visible text or structure is on screen.
- Use `snapshot -i` when you need refs such as `@e3` for interactive exploration.
- Use `snapshot -i -s "Camera"` or `snapshot -i -s @e3` when you want a smaller, scoped result.

Example:

```bash
agent-device snapshot -i
```

Sample output:

```text
Page: com.apple.Preferences
App: com.apple.Preferences

@e1 [ioscontentgroup]
  @e2 [button] "Camera"
  @e3 [button] "Privacy & Security"
```

## Refs vs selectors

- Use refs for discovery, debugging, and short local loops.
- Use selectors for deterministic scripts, assertions, and replay-friendly actions.
- Prefer selector or `@ref` targeting over raw coordinates.
- For tap interactions, `press` is canonical and `click` is an equivalent alias.

Examples:

```bash
agent-device press @e2
agent-device fill @e5 "test"
agent-device press 'id="camera_row" || label="Camera" role=button'
agent-device is visible 'id="camera_settings_anchor"'
```

## Text entry rules

- Use `fill` to replace text in an editable field.
- Use `type` to append text to the current insertion point.

## Query and sync rules

- Use `get` to read text, attrs, or state from a known target.
- Use `is` for assertions.
- Use `wait` when the UI needs time to settle after a mutation.
- Use `find "<query>" click --json` when you need search-driven targeting plus matched-target metadata.
- If you are forced onto raw coordinates, open [coordinate-system.md](coordinate-system.md) first.

Example:

```bash
agent-device find "Increment" click --json
```

Returned metadata comes from the matched snapshot node and can be used for observability or replay maintenance.

## QA from acceptance criteria

Use this loop when the task starts from acceptance criteria and you need to turn them into concrete checks.

Preferred mapping:

- visibility or presence claim: `is visible` or plain `snapshot`
- exact text, label, or value claim: `get text`
- post-action state change: act, then `wait`, then `is` or `get`
- nearby structural UI change: `diff snapshot`
- proof artifact for the final result: `screenshot` or `record`

Anti-hallucination rules:

- Do not invent app names, device ids, session names, refs, selectors, or package names.
- Discover them first with `devices`, `open`, `snapshot -i`, `find`, or `session list`.
- If refs drift after navigation, re-snapshot or switch to selectors instead of guessing.

Canonical QA loop:

```bash
agent-device open MyApp --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device wait visible 'label="Success"' 3000
agent-device is visible 'label="Success"'
agent-device screenshot /tmp/qa-proof.png
agent-device close
```

## Accessibility audit

Use this pattern when you need to find UI that is visible to a user but missing from the accessibility tree.

Audit loop:

1. Capture a `screenshot` to see what is visually rendered.
2. Capture a `snapshot` or `snapshot -i` to see what the accessibility tree exposes.
3. Compare the two:
   - visible in screenshot and present in snapshot: exposed to accessibility
   - visible in screenshot and missing from snapshot: likely accessibility gap
4. If you suspect the node exists in AX but is filtered from interactive output, retry with `snapshot --raw`.

Example:

```bash
agent-device screenshot /tmp/accessibility-screen.png
agent-device snapshot -i
```

Use `screenshot` as the visual source of truth and `snapshot` as the accessibility source of truth for this audit.

## Batch only when the sequence is already known

Use `batch` when a short command sequence is already planned and belongs to one logical screen flow.

```bash
agent-device batch --session sim --platform ios --steps-file /tmp/batch-steps.json --json
```

- Keep batch size moderate, roughly 5 to 20 steps.
- Add `wait` or `is exists` guards after mutating steps.
- Do not use `batch` for highly dynamic flows that need replanning after each step.

Step payload contract:

```json
[
  { "command": "open", "positionals": ["Settings"], "flags": { "platform": "ios" } },
  { "command": "wait", "positionals": ["label=\"Privacy & Security\"", "3000"], "flags": {} },
  { "command": "click", "positionals": ["label=\"Privacy & Security\""], "flags": {} },
  { "command": "get", "positionals": ["text", "label=\"Tracking\""], "flags": {} }
]
```

- `positionals` is optional and defaults to `[]`.
- `flags` is optional and defaults to `{}`.
- Nested `batch` and `replay` are rejected.
- Supported error mode is stop-on-first-error.

Response handling:

- Success returns fields such as `total`, `executed`, `totalDurationMs`, and `results[]`.
- Failed runs include `details.step`, `details.command`, `details.executed`, and `details.partialResults`.
- Replan from the first failing step instead of rerunning the whole flow blindly.

Common batch error categories:

- `INVALID_ARGS`: fix the payload shape and retry.
- `SESSION_NOT_FOUND`: open or select the correct session, then retry.
- `UNSUPPORTED_OPERATION`: switch to a supported command or surface.
- `AMBIGUOUS_MATCH`: refine the selector or locator, then retry the failed step.
- `COMMAND_FAILED`: add sync guards and retry from the failing step.

## Stop conditions

- If refs drift after transitions, switch to selectors.
- If a desktop surface or context menu is involved on macOS, load [macos-desktop.md](macos-desktop.md).
- If logs, network, alerts, or setup failures become the blocker, switch to [debugging.md](debugging.md).
- If the flow is stable and you need proof or replay maintenance, switch to [verification.md](verification.md).
