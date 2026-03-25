# macOS Desktop

## When to open this file

Open this file only when `--platform macos` is involved or the task needs `frontmost-app`, `desktop`, or `menubar` surfaces.

## Main commands to reach for first

- `open <app> --platform macos`
- `open --platform macos --surface frontmost-app|desktop|menubar`
- `snapshot -i`
- `get`
- `is`
- `click --button secondary`

## Most common mistake to avoid

Do not treat desktop surfaces like normal action surfaces. Use `app` sessions to act, and use `frontmost-app`, `desktop`, or `menubar` mainly to inspect until helper interaction parity exists.

## Canonical loop

```bash
agent-device open TextEdit --platform macos
agent-device snapshot -i
agent-device fill @e3 "desktop smoke test"
agent-device close
```

## Surface rules

- `app`: default surface and the normal choice for `click`, `fill`, `press`, `scroll`, `screenshot`, and `record`.
- `frontmost-app`: inspect the currently focused app without naming it first.
- `desktop`: inspect visible desktop windows across apps.
- `menubar`: inspect the active app menu bar and system menu extras.

Use inspect-first surfaces to understand desktop-global UI, then switch back to `app` when you need to act in one app.

## Snapshot expectations

- `snapshot -i` should describe UI visible to a human.
- `desktop` snapshots can include multiple windows from multiple apps.
- `menubar` snapshots can include both app-menu items and system menu extras.
- Finder-style rows, sidebar items, toolbar controls, search fields, and opened context menus should appear when visible.
- Finder and other native apps may expose duplicate-looking row, cell, and child text nodes. Treat them as distinct AX nodes unless you have a stronger selector anchor.

## Context menus

Context menus are not ambient UI. Open them explicitly, then re-snapshot.

```bash
agent-device click @e66 --button secondary --platform macos
agent-device snapshot -i
```

Expected loop:

1. Snapshot visible content.
2. Secondary-click the target item.
3. Snapshot again.
4. Interact with the new `menu-item` nodes.

## Targeting rules

- Prefer selectors or `@ref` values over raw coordinates.
- On macOS, window position can vary across runs, so coordinate-only flows are fragile.
- If the task only needs shared exploration rules, return to [exploration.md](exploration.md).

Selector guidance:

- Good selectors usually anchor on stable labels or app-owned identifiers such as `label="Downloads"` or `role=menu-item label="Rename"`.
- Avoid relying on framework-generated `_NS:*` identifiers as stable selectors.

Use `snapshot --raw --platform macos` only when debugging AX structure or collector filtering. Do not make raw snapshots the default agent loop.

Things not to rely on:

- Mobile-only helpers such as `install`, `reinstall`, or `push`.
- Desktop-global click or fill parity from `desktop` or `menubar` sessions.
- Raw coordinate assumptions across runs.

Troubleshooting:

- If visible content is missing from `snapshot -i`, re-snapshot after the UI settles.
- If `desktop` is too broad, retry with `frontmost-app`.
- If `menubar` is missing the expected menu, make the app frontmost first and retry.
- If the wrong menu opened, retry secondary-clicking the row or cell wrapper rather than the nested text node.
- If the app has multiple windows, make the correct window frontmost before relying on refs.
