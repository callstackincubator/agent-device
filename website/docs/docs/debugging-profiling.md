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

## What to use instead

If the task needs the React component tree, props, state, hooks, or render profiling, pair `agent-device` with the complementary [`agent-react-devtools`](https://github.com/callstackincubator/agent-react-devtools) project.

`agent-device` is centered on the device and app runtime layer. `agent-react-devtools` is the better fit for React internals.

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

- `perf` returns session-scoped startup and, where supported, CPU and memory samples.
- Startup is measured around the `open` command; it is not first-frame instrumentation.
- CPU and memory availability depends on platform and whether the active session is bound to an app/package.

## Where to go deeper

- Full command reference: [Commands](/docs/commands)
- Typed client observability APIs: [Typed Client](/docs/client-api)
- Session behavior and lifecycle: [Sessions](/docs/sessions)
