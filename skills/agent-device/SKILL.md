---
name: agent-device
description: Automates interactions for Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info across mobile, TV, and desktop targets.
---

# agent-device

Use this skill as a router.

## QA modes

- Open-ended bug hunt with reporting: use [../dogfood/SKILL.md](../dogfood/SKILL.md).
- Pass/fail QA from acceptance criteria: stay in this skill, start with [references/bootstrap-install.md](references/bootstrap-install.md), then use the QA loop in [references/exploration.md](references/exploration.md).

Default route inside this skill: bootstrap -> exploration -> optional debugging or verification. Open the macOS reference only for host Mac desktop work. Open the remote-tenancy reference only for remote daemon HTTP or lease flows.

## Mental model

- First choose the correct target and open the app or session you want to work on.
- Then inspect the current UI with `snapshot -i` and pick targets from the actual UI state.
- Act with `press`, `fill`, `get`, `is`, `wait`, or `find`.
- Re-snapshot after meaningful UI changes instead of reusing stale refs.
- End by capturing proof if needed, then `close`.

## Decision rules

- Use plain `snapshot` when you need to verify whether text is visible.
- Use `snapshot -i` mainly for interactive exploration and choosing refs.
- Use `fill` to replace text.
- Use `type` to append text.
- Prefer `@ref` or selector targeting over raw coordinates.
- Keep the default loop short: `open` -> explore/act -> optional debug or verify -> `close`.

## Choose a reference

- Target, install, session, or app bootstrap problem: [references/bootstrap-install.md](references/bootstrap-install.md)
- Need to discover UI, pick refs, wait, query, or interact: [references/exploration.md](references/exploration.md)
- Need logs, network, alerts, permissions, or failure triage: [references/debugging.md](references/debugging.md)
- Need screenshots, diff, recording, replay maintenance, or perf data: [references/verification.md](references/verification.md)
- Need host macOS desktop behavior or surface differences: [references/macos-desktop.md](references/macos-desktop.md)
- Need to connect to a remote `agent-device` daemon over HTTP or use tenant leases: [references/remote-tenancy.md](references/remote-tenancy.md)
