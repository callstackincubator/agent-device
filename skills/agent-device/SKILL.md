---
name: agent-device
description: Automates interactions for Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info across mobile, TV, and desktop targets.
---

# agent-device

Use this skill as a router.

For structured exploratory QA bug hunts and reporting, use [../dogfood/SKILL.md](../dogfood/SKILL.md).

## Default path

1. Open [bootstrap-install.md](bootstrap-install.md).
2. Then open [exploration.md](exploration.md).
3. Open [debugging.md](debugging.md) only if the task becomes a failure, logs, network, alert, or permission problem.
4. Open [verification.md](verification.md) only if the task needs evidence, replay maintenance, or performance checks.
5. Open [macos-desktop.md](macos-desktop.md) only when `--platform macos` or a desktop surface is involved.
6. Open [remote-tenancy.md](remote-tenancy.md) only for remote daemon, lease, tenant, or HTTP JSON-RPC work.

## Decision rules

- Use `app` sessions to act.
- Use `frontmost-app`, `desktop`, and `menubar` mainly to inspect until helper interaction parity exists.
- Use plain `snapshot` when you need to verify whether text is visible.
- Use `snapshot -i` mainly for interactive exploration and choosing refs.
- Use `fill` to replace text.
- Use `type` to append text.
- Prefer selector or `@ref` targeting over raw coordinates.
- Keep the default loop short: `open` -> explore/act -> optional debug or verify -> `close`.

## File chooser

- Target, install, session, or app bootstrap problem: [bootstrap-install.md](bootstrap-install.md)
- Need to discover UI, pick refs, wait, query, or interact: [exploration.md](exploration.md)
- Need logs, network, alerts, permissions, or failure triage: [debugging.md](debugging.md)
- Need screenshots, diff, recording, replay maintenance, or perf data: [verification.md](verification.md)
- Need host macOS desktop behavior or surface differences: [macos-desktop.md](macos-desktop.md)
- Need remote daemon transport or lease admission: [remote-tenancy.md](remote-tenancy.md)
