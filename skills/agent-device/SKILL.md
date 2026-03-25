---
name: agent-device
description: Automates interactions for Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info across mobile, TV, and desktop targets.
---

# agent-device

Use this skill as a router.

For exploratory QA bug hunts and reporting, use [../dogfood/SKILL.md](../dogfood/SKILL.md).

Default route: start with [references/bootstrap-install.md](references/bootstrap-install.md), then [references/exploration.md](references/exploration.md), then load debugging or verification only if the task needs them. Open the macOS and remote-tenancy references only for those exceptions.

## Decision rules

- Use `app` sessions to act.
- Use `frontmost-app`, `desktop`, and `menubar` mainly to inspect until helper interaction parity exists.
- Use plain `snapshot` when you need to verify whether text is visible.
- Use `snapshot -i` mainly for interactive exploration and choosing refs.
- Use `fill` to replace text.
- Use `type` to append text.
- Prefer selector or `@ref` targeting over raw coordinates.
- Keep the default loop short: `open` -> explore/act -> optional debug or verify -> `close`.

## Choose a reference

- Target, install, session, or app bootstrap problem: [references/bootstrap-install.md](references/bootstrap-install.md)
- Need to discover UI, pick refs, wait, query, or interact: [references/exploration.md](references/exploration.md)
- Need logs, network, alerts, permissions, or failure triage: [references/debugging.md](references/debugging.md)
- Need screenshots, diff, recording, replay maintenance, or perf data: [references/verification.md](references/verification.md)
- Need host macOS desktop behavior or surface differences: [references/macos-desktop.md](references/macos-desktop.md)
- Need remote daemon transport or lease admission: [references/remote-tenancy.md](references/remote-tenancy.md)
