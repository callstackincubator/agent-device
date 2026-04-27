---
name: dogfood
description: Systematically explore and test a mobile app on iOS/Android with agent-device to find bugs, UX issues, and other problems. Use when asked to dogfood, QA, exploratory test, find issues, bug hunt, or test this app on mobile.
allowed-tools: Bash(agent-device:*), Bash(npx agent-device:*)
---

# Dogfood

Router for exploratory QA. Read current CLI guidance:

```bash
agent-device help dogfood
```

Loop: open named session -> snapshot -i + screenshot -> explore flows -> capture evidence per issue -> close.

Target app is required; infer platform or ask. Default output is `./dogfood-output/`. Findings must come from runtime behavior, not source reads. Re-snapshot after mutations. Use logs, network, trace, perf, overlay screenshots, or react-devtools only when they add evidence.
