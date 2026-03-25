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

Example:

```bash
agent-device find "Increment" click --json
```

Returned metadata comes from the matched snapshot node and can be used for observability or replay maintenance.

## Batch only when the sequence is already known

Use `batch` when a short command sequence is already planned and belongs to one logical screen flow.

```bash
agent-device batch --session sim --platform ios --steps-file /tmp/batch-steps.json --json
```

- Keep batch size moderate, roughly 5 to 20 steps.
- Add `wait` or `is exists` guards after mutating steps.
- Do not use `batch` for highly dynamic flows that need replanning after each step.

## Stop conditions

- If refs drift after transitions, switch to selectors.
- If a desktop surface or context menu is involved on macOS, load [macos-desktop.md](macos-desktop.md).
