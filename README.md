<a href="https://www.callstack.com/open-source?utm_campaign=generic&utm_source=github&utm_medium=referral&utm_content=agent-device" align="center">
  <picture>
    <img alt="agent-device" src="website/docs/public/agent-device-banner.jpg">
  </picture>
</a>

---

# agent-device

`agent-device` is a CLI for mobile UI automation on iOS, tvOS, Android, and AndroidTV. It is designed for agent-driven workflows: inspect the UI, act on it deterministically, and keep that work session-aware and replayable.

If you know Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser), this project applies the same broad idea to mobile apps and devices.

## Project Goals

- Give agents a practical way to understand mobile UI state through structured snapshots.
- Keep automation flows token-efficient enough for real agent loops.
- Make common interactions reliable enough for repeated automation runs.
- Keep automation grounded in sessions, selectors, and replayable flows instead of one-off scripts.

## Core Ideas

- Sessions: open a target once, interact within that session, then close it cleanly.
- Snapshots: inspect the current accessibility tree in a compact form and get stable refs for exploration.
- Refs vs selectors: use refs for discovery, use selectors for durable replay and assertions.
- Human docs vs agent skills: docs explain the system for people; skills provide compact operating guidance for agents.

## Command Flow

The canonical loop is:

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device diff snapshot -i
agent-device fill @e5 "test"
agent-device close
```

In practice, most work follows the same pattern:

1. `open` a target app or URL.
2. `snapshot -i` to inspect the current screen.
3. `press`, `fill`, `scroll`, `get`, or `wait` using refs or selectors.
4. `diff snapshot` or re-snapshot after UI changes.
5. `close` when the session is finished.

## Where To Go Next

For people:

- [Introduction](website/docs/docs/introduction.md)
- [Quick Start](website/docs/docs/quick-start.md)
- [Commands](website/docs/docs/commands.md)
- [Snapshots](website/docs/docs/snapshots.md)
- [Selectors](website/docs/docs/selectors.md)
- [Sessions](website/docs/docs/sessions.md)
- [Configuration](website/docs/docs/configuration.md)
- [Client API](website/docs/docs/client-api.md)

For agents:

- [agent-device skill](skills/agent-device/SKILL.md)
- [Dogfood exploratory QA skill](skills/dogfood/SKILL.md)

## Install

```bash
npm install -g agent-device
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
