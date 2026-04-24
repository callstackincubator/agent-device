<a href="https://www.callstack.com/open-source?utm_campaign=generic&utm_source=github&utm_medium=referral&utm_content=agent-device" align="center">
  <picture>
    <img alt="agent-device" src="website/docs/public/agent-device-banner.jpg">
  </picture>
</a>

---

# agent-device

`agent-device` is a CLI for UI automation and app observability on iOS, tvOS, macOS, Android, and AndroidTV. It is built for agent-driven workflows: inspect the UI, interact deterministically, collect logs/network/perf evidence when behavior breaks, and keep the whole flow session-aware and replayable.

If you know Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser), this project applies the same broad idea to mobile apps and devices.

[![Watch the demo video](./website/docs/public/agent-device-contacts.gif)](./website/docs/public/agent-device-contacts.mp4)

## Project Goals

- Give agents a practical way to understand mobile UI state through structured snapshots.
- Keep automation flows token-efficient enough for real agent loops.
- Make common interactions reliable enough for repeated automation runs.
- Make debugging evidence easy to collect through logs, network inspection, and performance snapshots.
- Keep automation grounded in sessions, selectors, and replayable flows instead of one-off scripts.

## Core Ideas

- Sessions: open a target once, interact within that session, then close it cleanly.
- Snapshots: inspect the current accessibility tree in a compact form and get current-screen refs for exploration.
- Refs vs selectors: use refs for discovery, use selectors for durable replay and assertions.
- Observability: collect session logs, inspect recent HTTP traffic with `network dump`, and sample CPU/memory with `perf`.
- Tests: run deterministic `.ad` scripts as a light e2e test suite.
- Replay scripts: save `.ad` flows with `--save-script`, replay one script with `replay`, or run a folder/glob as a serial suite with `test`.
  `test` supports metadata-aware retries up to 3 additional attempts, per-test timeouts, flaky pass reporting, and runner-managed artifacts under `.agent-device/test-artifacts` by default. Each attempt writes `replay.ad` and `result.txt`; failed attempts also keep copied logs and artifacts when available.
- Human docs vs agent skills: docs explain the system for people; skills provide compact operating guidance for agents.

## Complementary Tooling

Use `agent-device` for on-device UI automation, screenshots/recordings, app logs, network inspection, and performance snapshots.

When the task needs the React Native component tree, props, state, hooks, or render profiling, use the bundled passthrough:

```bash
agent-device react-devtools status
agent-device react-devtools get tree --depth 3
agent-device react-devtools profile start
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 5
```

`react-devtools` dynamically runs pinned `agent-react-devtools@0.4.0` commands 1:1, so `agent-device` covers both the device/app runtime layer and React component internals without making React DevTools part of the daemon.

## Command Flow

The canonical loop is:

```bash
agent-device apps --platform ios
agent-device open SampleApp --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device diff snapshot -i
agent-device fill @e5 "test"
agent-device press @e5
agent-device type " more" --delay-ms 80
agent-device close
```

In practice, most work follows the same pattern:

1. Discover the exact app id with `apps` if the package or bundle name is uncertain.
2. `open` a target app or URL.
3. `snapshot -i` to inspect the current screen.
4. `press`, `fill`, `scroll`, `get`, or `wait` using refs or selectors. On iOS and Android, default snapshot text follows the same visible-first contract: refs shown in default output are actionable now, while hidden content is surfaced as scroll/list discovery hints instead of tappable off-screen refs. If the target only appears in a hidden-content hint, use `scroll <direction>` and re-snapshot.
   Use `rotate <orientation>` when a flow needs a deterministic portrait or landscape state on mobile targets.
5. `diff snapshot` or re-snapshot after UI changes.
6. `close` when the session is finished.

In non-JSON mode, core mutating commands print a short success acknowledgment so agents and humans can distinguish successful actions from dropped or silent no-ops.

## Where To Go Next

For people:

- [Website](https://agent-device.dev/)
- [Docs](https://incubator.callstack.com/agent-device/docs/introduction)

For agents:

- [agent-device skill](skills/agent-device/SKILL.md)
- [react-devtools skill](skills/react-devtools/SKILL.md)
- [dogfood skill](skills/dogfood/SKILL.md)
- [agent-device skill on ClawHub](https://clawhub.ai/okwasniewski/agent-device)

## Install

```bash
npm install -g agent-device
```

`agent-device` now performs a lightweight background upgrade check for interactive CLI runs and, when a newer package is available, suggests a global reinstall command. Updating the package also refreshes the bundled `skills/` shipped with the CLI.

Set `AGENT_DEVICE_NO_UPDATE_NOTIFIER=1` to disable the notice.

On macOS, `agent-device` includes a local `agent-device-macos-helper` source package that is built on demand for desktop permission checks, alert handling, and helper-backed desktop snapshot surfaces. Release distribution should use a signed/notarized helper build; source checkouts fall back to a local Swift build. Local helper overrides through `AGENT_DEVICE_MACOS_HELPER_BIN` must use an absolute executable path.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
