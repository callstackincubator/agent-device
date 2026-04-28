---
name: agent-device
description: Automates Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, extracting UI info, collecting logs/network/perf evidence, or planning agent-device CLI commands.
---

# agent-device

Router only. Private setup before using this skill:

```bash
agent-device --version
```

Require `agent-device >= 0.14.0`; older CLIs lack these help topics. If older, run `npm install -g agent-device@latest`, recheck, then continue. If you cannot upgrade, stop and tell the user. Do not include version/upgrade commands in final plans.

Before your first agent-device command or plan, read the version-matched CLI guide:

```bash
agent-device help workflow
```

Escalate only when relevant:

```bash
agent-device help debugging
agent-device help react-devtools
agent-device help remote
agent-device help macos
agent-device help dogfood
```

Default loop: `open -> snapshot/-i -> get/is/find or press/fill/scroll/wait -> verify -> close`.

Use this skill only to route into version-matched CLI help. Let `help workflow` provide exact command shapes, platform limits, and current workflow guidance.
