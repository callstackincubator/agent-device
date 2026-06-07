---
title: Debugging & Profiling
---

# Debugging & Profiling

Use `agent-device` when the task moves past UI automation and you need runtime evidence from the app or device layer.

## What `agent-device` covers well

- Session app logs for targeted debugging windows
- Network inspection from recent HTTP(s) entries in app logs via `network dump`
- Performance snapshots with `perf` / `metrics`
- Screenshots, recordings, and replayable repro flows

## React Native component internals

If the task needs the React Native component tree, props, state, hooks, or render profiling, use the `react-devtools` passthrough:

```bash
agent-device react-devtools status
agent-device react-devtools wait --connected
agent-device react-devtools get tree --depth 3
agent-device react-devtools get component @c5
agent-device react-devtools profile start
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
agent-device react-devtools profile rerenders --limit 5
agent-device react-devtools profile timeline --limit 20
agent-device react-devtools profile report @c5
```

`agent-device` remains centered on the device and app runtime layer. The `react-devtools` command dynamically runs pinned `agent-react-devtools` commands for React internals.

For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, start with `agent-device help react-native`. For slow-flow investigations, combine `help react-devtools` for the narrow React profile window with `help debugging` for log markers, network evidence, traces, and perf samples. Make one bounded first-pass survey with the `profile stop` summary, bounded `slow` and `rerenders` tables, and `timeline` only when commit timing matters; then drill into a specific `@c` ref with `profile report` instead of repeatedly raising broad `profile slow` limits.

React Native warning/error overlays belong to the app run. Treat them as findings or blockers: capture them, check `react-devtools errors` when connected, run `agent-device react-native dismiss-overlay` when the overlay is unrelated, then re-snapshot and report the overlay.

Use `alert wait`, `alert accept`, and `alert dismiss` for Android runtime permission prompts, Android native alerts, and iOS platform/app-owned modal dialogs. Do not use `settings permission` to answer a dialog already on screen. Reserve `settings permission` for setup or resetting permission state before a flow.

## Fast path

```bash
agent-device open MyApp --platform ios
agent-device logs clear --restart
agent-device logs mark "before repro"
agent-device press 'id="submit"'
agent-device network dump 25 --include headers
agent-device perf --json
agent-device logs path
```

Use this flow when you need a clean repro window with logs, recent network activity, and a quick perf sample from the active app session.

`open` prints `Session state: <path>`. Inspect that directory for per-run artifacts: `requests/<request-id>.ndjson` contains daemon request diagnostics, `runner.log` contains Apple runner/`xcodebuild` output, and `app.log` contains app/device logs when log capture is active. The top-level daemon log is for daemon lifecycle/startup issues.

On iOS simulators, `logs` scope by bundle id and the resolved app executable. For launch-time stdout/stderr, capture the direct app launch console instead of starting raw `simctl` streams:

```bash
agent-device open MyApp --platform ios --relaunch --launch-console ./artifacts/app.console.log
```

`--launch-console` is only for direct iOS simulator app launches, not URL opens.

## Core commands

### Logs

```bash
agent-device logs start
agent-device logs stop
agent-device logs clear --restart
agent-device logs path
agent-device logs doctor
agent-device logs mark "before submit"
```

- Logging is off by default; enable it only for focused debugging windows.
- Prefer `logs clear --restart` for clean repro loops.
- Use `logs path` and then grep the file instead of loading whole logs into agent context.

### Network inspection

```bash
agent-device network dump 25
agent-device network dump 25 --include headers
agent-device network dump 25 --include all
```

- `network dump` parses recent HTTP(s) entries from the session app log.
- `network log` is an alias for `network dump`.
- Parsed results depend on what the app emits into the platform log backend.

### Performance snapshots

```bash
agent-device perf --json
agent-device metrics --json
```

- `perf` returns session-scoped startup and, where supported, CPU, memory, and Android frame-health samples.
- Startup is measured around the `open` command; it is not first-frame instrumentation.
- CPU, memory, and Android frame-health availability depend on platform and whether the active session is bound to an app/package.
- On Android, use `metrics.fps.droppedFramePercent` for the health check and `metrics.fps.worstWindows` to line up jank clusters with logs, network activity, or recent actions.

## Where to go deeper

- Full command reference: [Commands](/docs/commands)
- Typed client observability APIs: [Typed Client](/docs/client-api)
- Session behavior and lifecycle: [Sessions](/docs/sessions)
