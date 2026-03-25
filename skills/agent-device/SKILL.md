---
name: agent-device
description: Automates interactions for Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info across mobile, TV, and desktop targets.
---

# agent-device

Use this skill as a router.

For structured exploratory QA bug hunts and reporting, use [../dogfood/SKILL.md](../dogfood/SKILL.md).

## Default path

1. Open [references/bootstrap-install.md](references/bootstrap-install.md).
2. Then open [references/exploration.md](references/exploration.md).
3. Open [references/debugging.md](references/debugging.md) only if the task becomes a failure, logs, network, alert, or permission problem.
4. Open [references/verification.md](references/verification.md) only if the task needs evidence, replay maintenance, or performance checks.
5. Open [references/macos-desktop.md](references/macos-desktop.md) only when `--platform macos` or a desktop surface is involved.
6. Open [references/remote-tenancy.md](references/remote-tenancy.md) only for remote daemon, lease, tenant, or HTTP JSON-RPC work.

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

- Target, install, session, or app bootstrap problem: [references/bootstrap-install.md](references/bootstrap-install.md)
- Need to discover UI, pick refs, wait, query, or interact: [references/exploration.md](references/exploration.md)
- Need logs, network, alerts, permissions, or failure triage: [references/debugging.md](references/debugging.md)
- Need screenshots, diff, recording, replay maintenance, or perf data: [references/verification.md](references/verification.md)
- Need host macOS desktop behavior or surface differences: [references/macos-desktop.md](references/macos-desktop.md)
- Need remote daemon transport or lease admission: [references/remote-tenancy.md](references/remote-tenancy.md)
