# macOS Desktop Automation

Use this reference for host Mac apps such as Finder, TextEdit, System Settings, Preview, or browser apps running as normal desktop windows.

## Start here

- Use `open <app> --platform macos` when you need to act inside one app.
- Use `open --platform macos --surface frontmost-app|desktop|menubar` when you need to inspect desktop-global UI first.
- Use `app` sessions for `click`, `fill`, `press`, `scroll`, `screenshot`, and `record`.
- Use `frontmost-app`, `desktop`, and `menubar` mainly for `snapshot`, `get`, `is`, and `wait`.
- Prefer `@ref` or selectors. Avoid raw coordinates unless there is no better target.

## Mental model

- `snapshot -i` should describe UI visible to a human.
- Context menus are not ambient UI. Open them explicitly with `click --button secondary`, then re-snapshot.
- Prefer refs for exploration and selectors for deterministic replay/assertions.
- If you inspect with `desktop` or `menubar` and then need to act on one app, switch to a normal `app` session.

## Canonical app flow

```bash
agent-device open Finder --platform macos
agent-device snapshot -i
agent-device click @e66 --button secondary --platform macos
agent-device snapshot -i
agent-device close
```

## Canonical desktop-global flow

```bash
agent-device open --platform macos --surface desktop
agent-device snapshot -i
agent-device get attrs @e4
agent-device is visible 'role="window" label="Finder"'
agent-device close
```

Surface variants:

```bash
agent-device open --platform macos --surface frontmost-app
agent-device open --platform macos --surface desktop
agent-device open --platform macos --surface menubar
```

- `app`: default session surface; use this for most real interaction work.
- `frontmost-app`: inspect the currently focused app without naming it first.
- `desktop`: inspect visible desktop windows across apps.
- `menubar`: inspect the active app menu bar and system menu extras.

Use `frontmost-app`, `desktop`, and `menubar` for read/inspect flows first. If the next step is a click/fill/press/scroll in one app, switch back to `app`.

## What to expect from snapshots

- `app` snapshots should focus on the chosen app window.
- `desktop` snapshots can contain multiple windows from multiple apps.
- `menubar` snapshots can contain both app-menu items and system menu extras.
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

Do not use `longpress` as a substitute for right-click on macOS.

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
- `role=window label="Notes"`

Prefer exact labels when the desktop UI is stable. Use `id=...` when the AX identifier is clearly app-owned and not a framework-generated `_NS:*` value.

## Things not to rely on

- Mobile-only helpers like `install`, `reinstall`, and `push`
- Desktop-global click/fill parity from `desktop` or `menubar` sessions
- Raw coordinate assumptions across runs; macOS windows can move
- Framework-generated `_NS:*` identifiers as stable selectors

## Troubleshooting

- If visible window content is missing from `snapshot -i`, re-snapshot once after the UI settles.
- If `desktop` is too broad, retry with `frontmost-app` to narrow the inspect surface.
- If `menubar` is missing the menu you expect, make the target app frontmost first, then re-open the `menubar` surface and snapshot again.
- If the wrong menu opened or no menu appeared, retry secondary-clicking the row/cell wrapper instead of the nested text node.
- If the app has multiple windows, ensure the correct one is frontmost before relying on refs.
