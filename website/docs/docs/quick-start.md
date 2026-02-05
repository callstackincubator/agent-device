---
title: Quick Start
---

# Quick Start

```bash
agent-device open Contacts --platform ios
agent-device snapshot -i
agent-device click @e5
agent-device fill @e6 "John"
agent-device close
```

Tips:

- Re-snapshot after navigation.
- Use `find` when you want semantic targeting instead of raw refs.
