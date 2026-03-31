<a href="https://www.callstack.com/open-source?utm_campaign=generic&utm_source=github&utm_medium=referral&utm_content=agent-device" align="center">
  <picture>
    <img alt="agent-device" src="website/docs/public/agent-device-banner.jpg">
  </picture>
</a>

---

# agent-device

`agent-device` is a CLI for UI automation on iOS, tvOS, macOS, Android, and AndroidTV. It is designed for agent-driven workflows: inspect the UI, act on it deterministically, and keep that work session-aware and replayable.

If you know Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser), this project applies the same broad idea to mobile apps and devices.

<video src="https://github.com/user-attachments/assets/db81d164-c179-4e68-97fa-53f06e467211" controls muted playsinline></video>

## Project Goals

- Give agents a practical way to understand mobile UI state through structured snapshots.
- Keep automation flows token-efficient enough for real agent loops.
- Make common interactions reliable enough for repeated automation runs.
- Keep automation grounded in sessions, selectors, and replayable flows instead of one-off scripts.

## Core Ideas

- Sessions: open a target once, interact within that session, then close it cleanly.
- Snapshots: inspect the current accessibility tree in a compact form and get stable refs for exploration.
- Refs vs selectors: use refs for discovery, use selectors for durable replay and assertions.
- Tests: run deterministic `.ad` scripts as a light e2e test suite.
- Replay scripts: save `.ad` flows with `--save-script`, replay one script with `replay`, or run a folder/glob as a serial suite with `test`.
  `test` supports metadata-aware retries up to 3 additional attempts, per-test timeouts, flaky pass reporting, and runner-managed artifacts under `.agent-device/test-artifacts` by default. Each attempt writes `replay.ad` and `result.txt`; failed attempts also keep copied logs and artifacts when available.
- Human docs vs agent skills: docs explain the system for people; skills provide compact operating guidance for agents.

## Command Flow

The canonical loop is:

```bash
agent-device open SampleApp --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device diff snapshot -i
agent-device fill @e5 "test"
agent-device fill @e5 "search" --delay-ms 80
agent-device close
```

In practice, most work follows the same pattern:

1. `open` a target app or URL.
2. `snapshot -i` to inspect the current screen.
3. `press`, `fill`, `scroll`, `get`, or `wait` using refs or selectors.
4. `diff snapshot` after UI changes, or `snapshot --diff` if you got there from snapshot help.
5. `close` when the session is finished.

In non-JSON mode, core mutating commands print a short success acknowledgment so agents and humans can distinguish successful actions from dropped or silent no-ops.

## Where To Go Next

For people:

- [Website](https://agent-device.dev/)
- [Docs](https://incubator.callstack.com/agent-device/docs/introduction)

For agents:

- [agent-device skill](skills/agent-device/SKILL.md)
- [dogfood skill](skills/dogfood/SKILL.md)
- [agent-device skill on ClawHub](https://clawhub.ai/okwasniewski/agent-device)

## Install

```bash
npm install -g agent-device
```

On macOS, `agent-device` includes a local `agent-device-macos-helper` source package that is built on demand for desktop permission checks, alert handling, and helper-backed desktop snapshot surfaces. Release distribution should use a signed/notarized helper build; source checkouts fall back to a local Swift build.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
