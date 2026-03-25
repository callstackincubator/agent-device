# Snapshot Refs and Selectors

## Purpose

Refs are useful for discovery/debugging. For deterministic scripts, use selectors.
For tap interactions, `press` is canonical; `click` is an equivalent alias.
For host Mac desktop apps, pair this reference with [macos-desktop.md](macos-desktop.md) because context menus and native list/table structures need desktop-specific handling.

## Snapshot

```bash
agent-device snapshot -i
```

Use plain `snapshot` when you need to verify whether text is visible on screen.
Use `snapshot -i` mainly for interactive exploration and choosing refs.

Output:

```
Page: com.apple.Preferences
App: com.apple.Preferences

@e1 [ioscontentgroup]
  @e2 [button] "Camera"
  @e3 [button] "Privacy & Security"
```

## Using refs (discovery/debug)

```bash
agent-device press @e2
agent-device fill @e5 "test"
```

On macOS, if actions live in a context menu, use:

```bash
agent-device click @e5 --button secondary --platform macos
agent-device snapshot -i
```

## Using selectors (deterministic)

```bash
agent-device press 'id="camera_row" || label="Camera" role=button'
agent-device fill 'id="search_input" editable=true' "test"
agent-device is visible 'id="camera_settings_anchor"'
```

## Ref lifecycle

Refs can become invalid when UI changes (navigation, modal, dynamic list updates).
Re-snapshot after transitions if you keep using refs.

## Scope snapshots

Use `-s` to scope to labels/identifiers. This reduces size and speeds up results:

```bash
agent-device snapshot -i -s "Camera"
agent-device snapshot -i -s @e3
```

## Diff snapshots (structural)

Use `diff snapshot` when you need compact state-change visibility between nearby UI states:

```bash
agent-device snapshot -i           # First snapshot initializes baseline
agent-device press @e5
agent-device diff snapshot -i           # Shows +/− structural lines vs prior snapshot
```

Efficient pattern:

- Initialize once at a stable point.
- Mutate UI (`press`, `fill`, `swipe`).
- Run `diff snapshot` after interactions to confirm expected change shape with bounded output.
- Re-run full/scoped `snapshot` only when you need fresh refs for next step selection.

## Troubleshooting

- Ref not found: re-snapshot.
- If `snapshot` returns 0 nodes, foreground app state or accessibility state may have changed. Re-open the app or retry after state is stable.
- On macOS, use `snapshot --raw --platform macos` to distinguish collector filtering from truly missing AX content.

## Stop Conditions

- If refs are unstable after UI transitions, switch to selector-based targeting and stop investing in ref-only flows.

## find click response

`find "<query>" click --json` returns deterministic matched-target metadata:

```json
{ "ref": "@e3", "locator": "any", "query": "Increment", "x": 195, "y": 422 }
```

Fields come from the matched snapshot node, not the platform runner. Use these for observability and replay quality — they are stable across runs for the same UI state.

## Replay note

- Prefer selector-based actions in recorded `.ad` replays.
- Use `agent-device replay -u <path>` to update selector drift and rewrite replay scripts in place.
