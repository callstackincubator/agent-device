# Snapshot Refs and Selectors (Mobile)

## Purpose

Refs are useful for discovery/debugging. For deterministic scripts, use selectors.

## Snapshot

```bash
agent-device snapshot -i
```

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
agent-device click @e2
agent-device fill @e5 "test"
```

## Using selectors (deterministic)

```bash
agent-device click 'id="camera_row" || label="Camera" role=button'
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

## Troubleshooting

- Ref not found: re-snapshot.
- AX returns Simulator window: restart Simulator and re-run.
- AX empty: verify Accessibility permission or use `--backend xctest` (XCTest is more complete).
- AX backend is simulator-only in v1; use `--backend xctest` on iOS devices.

## Replay note

- Prefer selector-based actions in recorded `.ad` replays.
- Use `agent-device replay -u <path>` to update selector drift and rewrite replay scripts in place.
