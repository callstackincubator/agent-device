---
name: agent-device
description: Automates interactions for iOS simulators/devices and Android emulators/devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info on mobile targets.
---

# Mobile Automation with agent-device

For exploration, use snapshot refs. For deterministic replay, use selectors.

## Start Here (Read This First)

Use this skill as a router, not a full manual.

1. Pick one mode:
   - Normal interaction flow
   - Debug/crash flow
   - Replay maintenance flow
2. Run one canonical flow below.
3. Open references only if blocked.

## Decision Map

- No target context yet: `devices` -> pick target -> `open`.
- Normal UI task: `open` -> `snapshot -i` -> `press/fill` -> `diff snapshot -i` -> `close`
- Debug/crash: `open <app>` -> `logs clear --restart` -> reproduce -> `logs path` -> targeted `grep`
- Replay drift: `replay -u <path>` -> verify updated selectors

## Canonical Flows

### 1) Normal Interaction Flow

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device diff snapshot -i
agent-device fill @e5 "test"
agent-device close
```

### 2) Debug/Crash Flow

```bash
agent-device open MyApp --platform ios
agent-device logs clear --restart
agent-device logs path
```

Logging is off by default. Enable only for debugging windows.
`logs clear --restart` requires an active app session (`open <app>` first).

### 3) Replay Maintenance Flow

```bash
agent-device replay -u ./session.ad
```

## Command Skeleton (Minimal)

### Session and navigation

```bash
agent-device devices
agent-device open [app|url] [url]
agent-device open [app] --relaunch
agent-device close [app]
agent-device session list
```

Use `boot` only as fallback when `open` cannot find/connect to a ready target.

### Snapshot and targeting

```bash
agent-device snapshot -i
agent-device diff snapshot -i
agent-device find "Sign In" click
agent-device press @e1
agent-device fill @e2 "text"
agent-device is visible 'id="anchor"'
```

`press` is canonical tap command; `click` is an alias.

### Utilities

```bash
agent-device appstate
agent-device get text @e1
agent-device screenshot out.png
agent-device trace start
agent-device trace stop ./trace.log
```

### Batch (when sequence is already known)

```bash
agent-device batch --steps-file /tmp/batch-steps.json --json
```

## Guardrails (High Value Only)

- Re-snapshot after UI mutations (navigation/modal/list changes).
- Prefer `snapshot -i`; scope/depth only when needed.
- Use refs for discovery, selectors for replay/assertions.
- Use `fill` for clear-then-type semantics; use `type` for focused append typing.
- iOS `appstate` is session-scoped; Android `appstate` is live foreground state.
- iOS settings helpers are simulator-only; use faceid `match|nonmatch|enroll|unenroll`.
- If using `--save-script`, prefer explicit path syntax (`--save-script=flow.ad` or `./flow.ad`).

## Common Mistakes

- Mixing debug flow into normal runs (keep logs off unless debugging).
- Continuing to use stale refs after screen transitions.
- Using URL opens with Android `--activity` (unsupported combination).
- Treating `boot` as default first step instead of fallback.

If the CLI is not installed in environment, use:
`npx -y agent-device`

## References

- [references/snapshot-refs.md](references/snapshot-refs.md)
- [references/logs-and-debug.md](references/logs-and-debug.md)
- [references/session-management.md](references/session-management.md)
- [references/permissions.md](references/permissions.md)
- [references/video-recording.md](references/video-recording.md)
- [references/coordinate-system.md](references/coordinate-system.md)
- [references/batching.md](references/batching.md)
