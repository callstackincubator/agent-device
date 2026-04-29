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
agent-device react-devtools get tree --depth 3
agent-device react-devtools get component @c5
agent-device react-devtools profile start
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
```

`agent-device` remains centered on the device and app runtime layer. The `react-devtools` command dynamically runs pinned `agent-react-devtools` commands for React internals.

## Fast path

```bash
agent-device open MyApp --platform ios
agent-device logs clear --restart
agent-device network dump 25 --include headers
agent-device perf --json
agent-device logs path
```

Use this flow when you need a clean repro window with logs, recent network activity, and a quick perf sample from the active app session.

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

- Full command reference: [Commands](/agent-device/pr-preview/pr-481/docs/commands.md)
- Typed client observability APIs: [Typed Client](/agent-device/pr-preview/pr-481/docs/client-api.md)
- Session behavior and lifecycle: [Sessions](/agent-device/pr-preview/pr-481/docs/sessions.md)
