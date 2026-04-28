---
name: dogfood
description: Systematically explore and test a mobile app on iOS/Android with agent-device to find bugs, UX issues, and other problems. Use when asked to dogfood, QA, exploratory test, find issues, bug hunt, or test this app on mobile.
allowed-tools: Bash(agent-device:*), Bash(npx agent-device:*)
---

# Dogfood

Router for exploratory QA. Private setup before using this skill:

```bash
agent-device --version
```

Require `agent-device >= 0.14.0`; older CLIs lack these help topics. If older, run `npm install -g agent-device@latest`, recheck, then continue. If you cannot upgrade, stop and tell the user. Do not include version/upgrade commands in final plans.

Read current CLI guidance:

```bash
agent-device help dogfood
```

Loop: open named session -> snapshot -i + screenshot -> explore flows -> capture evidence per issue -> close.

Target app is required; infer platform or ask. Default output is `./dogfood-output/`. Findings must come from runtime behavior, not source reads. Re-snapshot after mutations. Use logs, network, trace, perf, overlay screenshots, or react-devtools only when they add evidence.
