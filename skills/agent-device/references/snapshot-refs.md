# Snapshot + Refs Workflow (Mobile)

## Purpose

Refs let agents interact without repeating full UI trees. Snapshot -> refs -> click/fill.

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

## Using refs

```bash
agent-device click @e2
agent-device fill @e5 "test"
```

## Ref lifecycle

Refs become invalid when UI changes (navigation, modal, dynamic list updates).
Always re-snapshot after any transition.

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
