---
name: react-devtools
description: Inspect and profile React Native component trees from agent-device. Use when debugging React Native props, state, hooks, render causes, slow components, excessive rerenders, or questions like why a component rerendered.
---

# react-devtools

Router for React Native internals. Read current CLI guidance:

```bash
agent-device help react-devtools
```

Use `agent-device react-devtools ...` for component tree, props, state, hooks, render ownership, slow components, or rerenders. It dynamically runs pinned `agent-react-devtools@0.4.0`. Use normal `agent-device` commands for visible UI, refs, screenshots, logs, network, or perf.

Core loop:

```bash
agent-device react-devtools status
agent-device react-devtools wait --connected
agent-device react-devtools get tree --depth 3
agent-device react-devtools profile start
# perform the interaction with normal agent-device commands
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
```

Rules:

Keep reads bounded with `--depth`/`find`, treat `@c` refs as reload-local, profile only the investigated interaction, and run the same command in remote Android sessions; the CLI manages the companion tunnel.
