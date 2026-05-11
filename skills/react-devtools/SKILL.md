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

Use `agent-device react-devtools ...` for component tree, props, state, hooks, render ownership, performance profiling, slow components, or rerenders. Use normal `agent-device` commands for visible UI, refs, screenshots, logs, network, or device-level perf.

Keep reads bounded with `--depth`/`find`, treat `@c` refs as reload-local, and profile only the investigated interaction. Let `help react-devtools` provide exact command shapes, remote bridge ordering, pinned package details, and current workflow guidance.
