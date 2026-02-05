---
title: Selectors
---

# Selectors

Use `find` to locate elements by semantic attributes instead of raw refs.

```bash
agent-device find "Settings" click
agent-device find text "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find value "Search" type "query"
agent-device find role button click
agent-device find id "com.example:id/login" click
```

Tips:

- Use `find ... wait <timeoutMs>` to wait for UI to appear.
- Combine with scoped snapshots using `snapshot -s "<label>"` for speed.
