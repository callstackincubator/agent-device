# React Native Profiling

Use this workflow when the user reports slow interactions, excessive re-renders, unstable props, or unclear render causes.

## Baseline

```bash
agent-device react-devtools status
agent-device react-devtools count
agent-device react-devtools get tree --depth 3
```

If the app is not connected, run:

```bash
agent-device react-devtools start
agent-device react-devtools wait --connected
```

Then reload or relaunch the React Native app if needed.

## Capture One Interaction

```bash
agent-device react-devtools profile start "short label"
# Trigger exactly the interaction being investigated.
agent-device react-devtools profile stop
```

Keep the profiling window narrow. Extra navigation, warm-up work, or unrelated gestures make the report harder to interpret.

## Identify Suspects

```bash
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
```

- A component with high average render time is a slow-render suspect.
- A component with high render count is a re-render suspect.
- A component can be both.

## Drill In

```bash
agent-device react-devtools profile report @c12
agent-device react-devtools get component @c12
```

Use `profile report` to identify render causes and changed keys. Use `get component` to inspect current props, state, and hooks.

Common interpretations:

| Signal                                     | Meaning                             | Typical follow-up                              |
| ------------------------------------------ | ----------------------------------- | ---------------------------------------------- |
| `props-changed` with function props        | Parent may pass unstable callbacks  | Check whether the parent can use `useCallback` |
| `props-changed` with object or array props | Parent may pass unstable references | Check whether the parent can use `useMemo`     |
| `parent-rendered` with many child renders  | Child has no bailout                | Check whether `React.memo` is appropriate      |
| `state-changed`                            | Component state caused the render   | Check whether the state update is necessary    |
| `hooks-changed`                            | Hook value or dependency changed    | Inspect hook values and dependencies           |

## Verify

After making a change, repeat the same interaction:

```bash
agent-device react-devtools profile start "after fix"
# Repeat the same interaction.
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
```

Compare render counts, average durations, changed keys, and commit counts against the baseline.
