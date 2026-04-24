# React DevTools Commands

All commands are run through `agent-device react-devtools`.

## Connection

```bash
agent-device react-devtools start
agent-device react-devtools stop
agent-device react-devtools status
agent-device react-devtools wait --connected --timeout 30
agent-device react-devtools wait --component <ComponentName> --timeout 30
```

- `status` shows the daemon port, connected apps, component count, profiling state, uptime, and last connection event.
- Most commands auto-start the daemon, but `start` is useful before launching or reloading the app.
- React Native development builds connect to the daemon on port 8097. For Android physical devices, use `adb reverse tcp:8097 tcp:8097` if the app cannot reach the host.

## Component Inspection

```bash
agent-device react-devtools get tree --depth 3
agent-device react-devtools get component @c5
agent-device react-devtools find Button
agent-device react-devtools find Button --exact
agent-device react-devtools count
agent-device react-devtools errors
```

- `get tree` prints a component hierarchy with labels like `@c1`, `@c2`.
- Use `--depth` on large apps. Start at `--depth 3` or `--depth 4`.
- `get component` accepts a label or numeric React fiber id and shows props, state, and hooks.
- `find` searches by display name. Use `--exact` when fuzzy results are noisy.
- `errors` lists components with React-tracked warnings or errors.

## Profiling

```bash
agent-device react-devtools profile start "interaction name"
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
agent-device react-devtools profile report @c5
agent-device react-devtools profile timeline --limit 20
agent-device react-devtools profile commit 3
agent-device react-devtools profile export profile.json
agent-device react-devtools profile diff before.json after.json --limit 10
```

- `profile slow` ranks components by average render duration.
- `profile rerenders` ranks components by render count.
- `profile report @cN` shows render causes and changed props/state/hooks for one component.
- `profile timeline` lists commits. Use `--limit` and `--offset` for long sessions.
- `profile export` writes React DevTools Profiler JSON that can be diffed later.

## Common Flows

Inspect a component:

```bash
agent-device react-devtools status
agent-device react-devtools get tree --depth 3
agent-device react-devtools find SearchScreen
agent-device react-devtools get component @c12
```

Profile a slow interaction:

```bash
agent-device react-devtools profile start "slow search"
# Trigger the interaction with agent-device or ask the user to perform it.
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
```

Verify a render fix:

```bash
agent-device react-devtools profile start "after fix"
# Repeat the same interaction.
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
```
