---
name: react-devtools
description: Inspect and profile React Native component trees from agent-device. Use for React Native performance, profiling, props, state, hooks, render causes, slow components, excessive rerenders, or questions like why a component rerendered.
---

# react-devtools

Router for React Native internals. Private setup before using this skill:

```bash
agent-device --version
```

Require `agent-device >= 0.14.0`; older CLIs lack these help topics. If older, run `npm install -g agent-device@latest`, recheck, then continue. If you cannot upgrade, stop and tell the user. Do not include version/upgrade commands in final plans.

Read current CLI guidance:

```bash
agent-device help react-devtools
```

Use `agent-device react-devtools ...` for component tree, props, state, hooks, render ownership, performance profiling, slow components, or rerenders. It dynamically runs pinned `agent-react-devtools@0.4.0`. Use normal `agent-device` commands for visible UI, refs, screenshots, logs, network, or device-level perf.

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

Remote iOS bridge order:

```bash
agent-device open <bundle-id> --platform ios --relaunch
agent-device react-devtools start
agent-device open <bundle-id> --platform ios --relaunch
agent-device react-devtools wait --connected
```

Rules:

Keep reads bounded with `--depth`/`find`, treat `@c` refs as reload-local, profile only the investigated interaction, and run the same command in remote Android sessions; the CLI manages the needed local service tunnel. For remote iOS, relaunch after `react-devtools start` because React Native opens the legacy DevTools websocket during JavaScript startup.
