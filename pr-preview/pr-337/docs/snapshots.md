# Snapshots

Snapshots provide a structured view of the UI and generate current-screen refs.

```bash
agent-device snapshot                    # Full accessibility tree
agent-device snapshot -i                 # Interactive elements only (recommended)
agent-device snapshot -c                 # Compact (remove empty elements)
agent-device snapshot -d 3               # Limit depth to 3 levels
agent-device snapshot -s "Contacts"      # Scope to label/identifier
agent-device snapshot -i -c -d 5         # Combine options
agent-device diff snapshot               # Preferred structural diff vs previous session baseline
agent-device snapshot --diff             # Alias for the same diff operation
```

| Option       | Description               |
| ------------ | ------------------------- |
| `-i`         | Interactive-only output   |
| `-c`         | Compact structural noise  |
| `-d <depth>` | Limit tree depth          |
| `-s <scope>` | Scope to label/identifier |

Note: If XCTest returns 0 nodes (foreground app changed), agent-device fails explicitly.
It does not automatically switch to AX.

## Efficient snapshot usage

- Default to `snapshot -i` for agent loops.
- Default human-readable snapshot output is visible-first. Off-screen interactive content is collapsed into compact discovery summaries such as `[off-screen below] 3 interactive items: "Privacy", "Battery", "About"`.
- Add `-s "<label>"` (or `-s @ref`) to keep results screen-local.
- Add `-d <depth>` when you only need upper hierarchy layers.
- If `snapshot -i` returns 0 nodes on Android but the screen is visibly populated, trust `screenshot` as visual truth, wait briefly, then take one fresh `snapshot -i`.
- If `snapshot -i -d <n>` says the interactive output is empty at that depth, retry once without `-d` before taking more shallow snapshots.
- Re-snapshot after any UI mutation before reusing refs.
- On Android after navigation or submit, if `snapshot -i` disagrees with the visible screen, trust `screenshot`, wait briefly, then take one fresh snapshot instead of looping stale snapshots.
- Use `diff snapshot` between mutations to validate structural changes with lower output volume.
- Use `snapshot --diff` when you discover the feature from snapshot help, but keep `diff snapshot` as the default exploration command.
- Keep `--raw` for troubleshooting only when you need the full tree instead of visible-first output.

`diff snapshot` and `snapshot --diff` behavior:

- First run initializes baseline (`baselineInitialized: true` in JSON).
- Later runs return unified-style lines (`+` added, `-` removed, unchanged context) and update baseline after each call.

## Example output:

```bash
agent-device snapshot -i
# Output:
# Snapshot: 9 visible nodes (14 total)
# @e1 [application] "Contacts"
#   @e2 [window]
#     @e3 [other]
#   @e4 [other] "Lists"
#     @e5 [navigation-bar] "Lists"
#       @e6 [button] "Lists"
#       @e7 [text] "Contacts"
#     @e8 [other] "John Doe"
#       @e9 [other] "John Doe"
# [off-screen below] 2 interactive items: "All Contacts", "New List"
```

## Backends (iOS):

- `xctest` (default): full fidelity, fast, no Accessibility permission required.
- `ax`: fast accessibility tree, may miss details, requires Accessibility permission; simulator-only.
