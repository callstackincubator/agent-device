---
name: agent-device
description: Automates interactions for Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info across mobile, TV, and desktop targets.
---

# agent-device

Use this skill as a router with mandatory defaults. Read this file first. If target, app, or session readiness is uncertain, load `references/bootstrap-install.md` first. Once the app session is open and stable, use `references/exploration.md` for inspection and interaction.

## Default operating rules

- Start conservative. Prefer read-only inspection before mutating the UI.
- Use plain `snapshot` when the task is to verify what text or structure is currently visible on screen.
- Use `snapshot -i` only when you need interactive refs such as `@e3` for a requested action or targeted query.
- Avoid speculative mutations. You may take the smallest reversible UI action needed to unblock inspection or complete the requested task, such as dismissing a popup, closing an alert, or clearing an unintended surface.
- Do not browse the web or use external sources unless the user explicitly asks.
- Re-snapshot after meaningful UI changes instead of reusing stale refs.
- Prefer `@ref` or selector targeting over raw coordinates.
- Ensure the correct target is pinned and an app session is open before interacting.
- Keep the loop short: `open` -> inspect/act -> verify if needed -> `close`.

## Default flow

1. Decide whether the correct target, app install, and app session are already ready.
2. If readiness is uncertain, or there is no simulator, device, app install, or open app session yet, load [references/bootstrap-install.md](references/bootstrap-install.md) and establish that deterministically.
3. Once the app session is open and stable, load [references/exploration.md](references/exploration.md).
4. Start with plain `snapshot` if the goal is to read or verify what is visible.
5. Escalate to `snapshot -i` only if you need refs for interactive exploration or a requested action.
6. Use `get`, `is`, or `find` before mutating the UI when a read-only command can answer the question.
7. End by capturing proof if needed, then `close`.

## QA modes

- Open-ended bug hunt with reporting: use [../dogfood/SKILL.md](../dogfood/SKILL.md).
- Pass/fail QA from acceptance criteria: stay in this skill, start with [references/bootstrap-install.md](references/bootstrap-install.md), then use the QA loop in [references/exploration.md](references/exploration.md).

## Deterministic routing

- Load [references/bootstrap-install.md](references/bootstrap-install.md) when target, install, open, or session readiness is uncertain, especially in sandbox or cloud environments.
- Load [references/exploration.md](references/exploration.md) once the app session is open and stable.
- Load additional references only when their scope is needed.

## Decision rules

- Use plain `snapshot` when you need to verify whether text is visible.
- Use `snapshot -i` mainly for interactive exploration and choosing refs.
- Use `get`, `is`, or `find` when they can answer the question without changing UI state.
- Use `fill` to replace text.
- Use `type` to append text.
- If there is no simulator, no app install, or no open app session yet, switch to `bootstrap-install.md` instead of improvising setup steps.
- Use the smallest unblock action first when transient UI blocks inspection, but do not navigate, search, or enter new text just to make the UI reveal data unless the user asked for that interaction.
- Do not use external lookups to compensate for missing on-screen data unless the user asked for them.
- If the needed information is not exposed on screen, say that plainly instead of compensating with extra navigation, text entry, or web search.
- Prefer `@ref` or selector targeting over raw coordinates.

## Choose a reference

- Pick target device, install, open, or manage sessions: [references/bootstrap-install.md](references/bootstrap-install.md)
- Need to discover UI, pick refs, wait, query, or interact: [references/exploration.md](references/exploration.md)
- Need logs, network, alerts, permissions, or failure triage: [references/debugging.md](references/debugging.md)
- Need screenshots, diff, recording, replay maintenance, or perf data: [references/verification.md](references/verification.md)
- Need desktop surfaces, menu bar behavior, or macOS-specific interaction rules: [references/macos-desktop.md](references/macos-desktop.md)
- Need to connect to a remote `agent-device` daemon over HTTP or use tenant leases: [references/remote-tenancy.md](references/remote-tenancy.md)
