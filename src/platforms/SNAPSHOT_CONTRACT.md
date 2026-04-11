# Snapshot Traversal Contract

Each platform backend (Swift/XCTest, Android/UIAutomator, Python/AT-SPI2) produces
a flat array of `RawSnapshotNode` objects. Despite different accessibility frameworks,
all backends must conform to this shared contract so that the downstream pipeline
(filtering, ref assignment, presentation) works identically.

## Output schema

Every node in the `nodes` array must include:

| Field         | Type                             | Required | Notes                                     |
| ------------- | -------------------------------- | -------- | ----------------------------------------- |
| `index`       | `number`                         | yes      | Sequential, 0-based, pre-order DFS        |
| `type`        | `string`                         | yes      | Normalized role (see table below)         |
| `role`        | `string`                         | no       | Raw platform role for debugging           |
| `label`       | `string \| undefined`            | no       | Accessible name or description            |
| `value`       | `string \| undefined`            | no       | Text content or numeric value             |
| `rect`        | `{x, y, width, height} \| undef` | no       | Screen-absolute bounding rect             |
| `enabled`     | `boolean \| undefined`           | no       |                                           |
| `selected`    | `boolean \| undefined`           | no       |                                           |
| `hittable`    | `boolean \| undefined`           | no       | Can receive pointer/touch events          |
| `depth`       | `number`                         | yes      | Tree depth (root = 0)                     |
| `parentIndex` | `number \| undefined`            | no       | Index of parent node; undefined for roots |

Platform-specific fields (optional, passed through):

- `pid`, `appName`, `windowTitle` (Linux, macOS desktop)
- `identifier`, `subrole` (iOS/macOS)
- `resourceId`, `className` (Android)

## Traversal rules

| Parameter  | Default | Description                                  |
| ---------- | ------- | -------------------------------------------- |
| `maxNodes` | 1500    | Stop traversal after this many nodes         |
| `maxDepth` | 12      | Do not descend beyond this tree depth        |
| `maxApps`  | 24      | Desktop only: max top-level apps to traverse |

- Traversal order is **pre-order depth-first**.
- `index` values are assigned in traversal order (0, 1, 2, …).
- `parentIndex` points to the containing node's `index`.
- When `maxNodes` is reached, set `truncated: true` in the result.
- Backends should skip defunct/inaccessible subtrees gracefully.

## Surface semantics

| Surface         | Behavior                                             |
| --------------- | ---------------------------------------------------- |
| `app`           | Snapshot the target application's UI tree            |
| `frontmost-app` | Snapshot the focused/frontmost application (desktop) |
| `desktop`       | Snapshot all visible applications on the desktop     |
| `menubar`       | macOS only: snapshot the system menu bar             |

## Normalized role types

All backends must map platform-specific roles to these normalized strings.
The canonical mapping is maintained in:

- **iOS/macOS**: `ios-runner/…/SnapshotTraversal.swift` → `normalizedSnapshotType`
- **Android**: `src/platforms/android/ui-hierarchy.ts` → `normalizeAndroidType`
- **Linux**: `src/platforms/linux/role-map.ts` → `normalizeAtspiRole`

Common normalized types: `Button`, `StaticText`, `TextField`, `TextArea`,
`CheckBox`, `RadioButton`, `Switch`, `ComboBox`, `Tab`, `TabList`,
`Menu`, `MenuItem`, `MenuBar`, `List`, `ListItem`, `Table`, `Cell`, `Row`,
`Tree`, `TreeItem`, `Group`, `Window`, `Dialog`, `Alert`, `ScrollArea`,
`ScrollBar`, `Slider`, `ProgressBar`, `Image`, `Link`, `Separator`,
`Toolbar`, `StatusBar`, `Tooltip`, `Application`, `Heading`.

Unmapped roles should be PascalCased (e.g., `"extended table"` → `"ExtendedTable"`).

## Linux platform notes

### Surface mapping

Linux maps session surfaces to AT-SPI2 as follows:

| Session surface | AT-SPI2 behaviour                                                     |
| --------------- | --------------------------------------------------------------------- |
| `app`           | Maps to `frontmost-app` (focused window)                              |
| `frontmost-app` | Traverses the focused application's tree                              |
| `desktop`       | Traverses all visible applications                                    |
| `menubar`       | **Not supported** — falls back to `desktop` with a diagnostic warning |

### Supported commands

Linux supports: `back`, `click`, `close`, `diff`, `fill`, `find`, `focus`,
`get`, `home`, `is`, `longpress`, `open`, `press`, `screenshot`, `scroll`,
`snapshot`, `swipe`, `type`, `wait`.

Not supported (blocked at capability level): `alert`, `app-switcher`, `apps`,
`boot`, `install`, `keyboard`, `logs`, `network`, `perf`, `pinch`,
`push`, `record`, `reinstall`, `rotate`, `settings`,
`trigger-app-event`.

### Known limitations

- Input synthesis uses `xdotool` (X11) or `ydotool` (Wayland) — availability depends on the desktop environment.
- On Wayland without `ydotool`, falls back to `xdotool` with a diagnostic warning (may not work).
- Clipboard requires `xclip`/`xsel` (X11) or `wl-copy`/`wl-paste` (Wayland).
- Settings operations are not supported.

## Adding a new platform

1. Implement a snapshot function returning `{ nodes: RawSnapshotNode[], truncated: boolean }`.
2. Map platform roles to the normalized types listed above.
3. Add unit tests verifying role normalization and node schema conformance.
4. Wire into `snapshot-capture.ts` (`captureSnapshotData`) and `dispatch.ts`.
