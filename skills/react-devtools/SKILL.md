---
name: react-devtools
description: Inspect and profile React Native component trees from agent-device. Use when debugging React Native props, state, hooks, render causes, slow components, excessive re-renders, or questions like why a component re-rendered.
---

# react-devtools

Use this skill when the task needs React Native internals that are not visible in the accessibility tree: component hierarchy, props, state, hooks, render causes, or profiling data.

Run commands through `agent-device react-devtools`. The command dynamically runs pinned `agent-react-devtools@0.4.0` and passes arguments through 1:1.

The first run may download the pinned package from npm. Put downstream flags after `react-devtools` so they pass through to `agent-react-devtools`.

## Default flow

1. Use `agent-device` to open the React Native app and verify the visible state when needed.
2. Check `agent-device react-devtools status`.
3. If no app is connected, start or wait for the devtools daemon, then reload or relaunch the app.
4. Inspect with `get tree`, `find`, and `get component`.
5. Profile only around the interaction being investigated.
6. Verify the fix with the same command sequence and interaction.

## Main commands

```bash
agent-device react-devtools status
agent-device react-devtools wait --connected
agent-device react-devtools get tree --depth 3
agent-device react-devtools find <ComponentName>
agent-device react-devtools get component @c5
agent-device react-devtools profile start
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
```

## Decision rules

- Need current UI text, refs, screenshots, logs, network, or device metrics: use the `agent-device` skill.
- Need props, state, hooks, component ownership, render causes, or React profiler data: use this skill.
- Start component-tree reads with `get tree --depth 3` or `find <name>` to keep output bounded.
- Labels like `@c5` reset when the app reloads or components remount. After reload, run `wait --connected` and inspect again.
- Profiling only captures renders between `profile start` and `profile stop`.

## References

| File                                    | When to read                                  |
| --------------------------------------- | --------------------------------------------- |
| [commands.md](references/commands.md)   | Command reference and common inspection flows |
| [profiling.md](references/profiling.md) | Render profiling workflow and interpretation  |
