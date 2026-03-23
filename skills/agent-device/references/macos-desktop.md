# macOS Desktop Automation

Use this reference for host Mac apps such as Finder, TextEdit, System Settings, Preview, or browser apps running as normal desktop windows.

## Mental model

- `snapshot -i` should describe UI that is visible to a human in the current front window.
- Context menus are not ambient UI. Open them explicitly with `click --button secondary`, then re-snapshot.
- Prefer refs for exploration and selectors for deterministic replay/assertions.
- Avoid raw `x y` coordinates unless refs/selectors are impossible.

## Canonical flow

```bash
agent-device open Finder --platform macos
agent-device snapshot -i
agent-device click @e66 --button secondary --platform macos
agent-device snapshot -i
agent-device close
```

## What to expect from snapshots

- `snapshot -i` prioritizes visible window content over dormant menu infrastructure.
- File rows, sidebar items, toolbar controls, search fields, and visible context menus should appear.
- Finder and other native apps may expose duplicate-looking structures such as row wrapper nodes, `cell` nodes, and child `text` or `text-field` nodes.
- Treat those as distinct AX nodes unless you have a stronger selector anchor.

## Context menus

Use secondary click when the app exposes actions only through the contextual menu.

```bash
agent-device click @e66 --button secondary --platform macos
agent-device snapshot -i
```

Expected pattern:

1. Snapshot visible content.
2. Secondary-click the target row/item.
3. Snapshot again.
4. Interact with newly visible `menu-item` nodes.

Do not expect context-menu items to appear before the menu is opened.

## Finder-specific guidance

- `snapshot -i` should still expose visible folder rows even when nothing is selected.
- Unselected folder contents should still be visible in `snapshot -i` through list/table rows.
- A file row may expose multiple nodes with the same label, including a row container, name cell, and child text/text-field.
- For opening a context menu, prefer the outer visible row/cell ref over a nested text child if both exist.
- After secondary click, expect actions such as `Rename`, `Quick Look`, `Copy`, `Compress`, and tag-related items in the next snapshot.

## Raw snapshots

Use `snapshot --raw` only when debugging AX structure or collector issues.

```bash
agent-device snapshot --raw --platform macos
```

- Raw output is larger and less token-efficient.
- It is useful for verifying whether missing UI is absent from the AX tree or only filtered from interactive output.
- Do not use raw output as the default agent loop when `snapshot -i` already shows the visible window content you need.

## Selector guidance

Good macOS selectors usually anchor on one of:

- `label="Downloads"`
- `label="failed-step.json"`
- `role=button label="Search"`
- `role=menu-item label="Rename"`

Prefer exact labels when the desktop UI is stable. Use `id=...` when the AX identifier is clearly app-owned and not a framework-generated `_NS:*` value.

## Things not to rely on

- Mobile-only helpers like `install`, `reinstall`, `push`, `logs`, `network`, or generic `alert`
- Long-press as a substitute for right-click
- Raw coordinate assumptions across runs; macOS windows can move
- Framework-generated `_NS:*` identifiers as stable selectors

## Troubleshooting

- If visible window content is missing from `snapshot -i`, re-snapshot once after the UI settles.
- If the wrong menu opened or no menu appeared, retry secondary-clicking the row/cell wrapper instead of the nested text node.
- If the app has multiple windows, ensure the correct one is frontmost before relying on refs.
