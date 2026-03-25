---
name: agent-device
description: Automates interactions for Apple-platform apps (iOS, tvOS, macOS) and Android devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info across mobile, TV, and desktop targets.
---

# Apple and Android Automation with agent-device

Use this skill as a router.

Core rule:

- explore with `snapshot -i` and `@ref`
- stabilize with selectors
- use plain `snapshot` when you need to verify whether text is visible
- re-snapshot after every meaningful UI change

For exploratory QA bug hunts and reporting, use [../dogfood/SKILL.md](../dogfood/SKILL.md).

## Quick route

- Normal UI task: `open` -> `snapshot -i` -> `click/fill/press` -> `close`
- Debug task: `open` -> `logs clear --restart` -> reproduce -> `network dump` -> `logs path`
- Replay drift: `replay -u <path>`
- No target context yet: `devices` -> pick target -> `open`

## Target rules

- iOS local QA: prefer simulators
- Android binary flow: `install` or `reinstall` first, then `open <package> --relaunch`
- In mixed-device labs, always pin the target with `--device`, `--udid`, `--serial`, or an isolation scope
- For session-bound automation, prefer `AGENT_DEVICE_SESSION` + `AGENT_DEVICE_PLATFORM`

## macOS rules

- Use `open <app> --platform macos` for normal Mac app automation
- Use `open --platform macos --surface frontmost-app|desktop|menubar` when you need desktop-global inspection first
- Use `app` sessions for `click`, `fill`, `press`, `scroll`, `screenshot`, and `record`
- Use `frontmost-app`, `desktop`, and `menubar` mainly for `snapshot`, `get`, `is`, and `wait`
- If you inspect with `desktop` or `menubar` and then need to act inside one app, open that app in a normal `app` session
- Prefer `@ref` or selectors over raw `x y` on macOS
- Use `click --button secondary` for context menus, then run `snapshot -i` again

## Canonical flows

### Normal flow

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device fill @e5 "test"
agent-device close
```

### macOS app flow

```bash
agent-device open TextEdit --platform macos
agent-device snapshot -i
agent-device fill @e3 "desktop smoke test"
agent-device screenshot /tmp/macos-textedit.png
agent-device close
```

### macOS desktop-global inspect flow

```bash
agent-device open --platform macos --surface desktop
agent-device snapshot -i
agent-device get attrs @e4
agent-device is visible 'role="window" label="Notes"'
agent-device wait text "Notes"
agent-device close
```

### Android relaunch flow

```bash
agent-device reinstall MyApp /path/to/app-debug.apk --platform android --serial emulator-5554
agent-device open com.example.myapp --remote-config ./agent-device.remote.json --relaunch
agent-device snapshot -i
agent-device close
```

### Debug flow

```bash
agent-device open MyApp --platform ios
agent-device logs clear --restart
agent-device network dump 25
agent-device logs path
```

### Replay maintenance

```bash
agent-device replay -u ./session.ad
```

## High-value guardrails

- Prefer `snapshot -i`; use `--raw` only for structure debugging
- Use plain `snapshot` to verify text visibility; use `snapshot -i` mainly for interactive exploration and choosing refs
- Use refs for discovery, selectors for replay/assertions
- `fill` clears then types; `type` only types into the focused field
- `network dump` is best-effort and reads from the session app log
- `logs clear --restart` requires an active app session
- On macOS, helper-backed flows cover permissions, alerts, and desktop-global snapshot surfaces
- On macOS, do not assume `desktop` or `menubar` are the best surface for real interactions yet

## References

- [references/macos-desktop.md](references/macos-desktop.md)
- [references/snapshot-refs.md](references/snapshot-refs.md)
- [references/logs-and-debug.md](references/logs-and-debug.md)
- [references/session-management.md](references/session-management.md)
- [references/permissions.md](references/permissions.md)
- [references/video-recording.md](references/video-recording.md)
- [references/coordinate-system.md](references/coordinate-system.md)
- [references/batching.md](references/batching.md)
- [references/perf-metrics.md](references/perf-metrics.md)
- [references/remote-tenancy.md](references/remote-tenancy.md)
