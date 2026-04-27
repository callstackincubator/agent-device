<a href="https://www.callstack.com/open-source?utm_campaign=generic&utm_source=github&utm_medium=referral&utm_content=agent-device" align="center">
  <picture>
    <img alt="agent-device" src="website/docs/public/agent-device-banner.jpg">
  </picture>
</a>

---

# agent-device

Device automation CLI for AI agents. Mobile, TV, and desktop.

Run the app. Inspect the UI. Collect the evidence. Repeat the flow.

It gives agents structured UI access, deterministic interactions, screenshots, recordings, logs, network inspection, performance data, and replayable sessions on iOS, Android, tvOS, macOS, and Linux. If you know Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser), this is the same idea for apps and devices.

[![Watch the demo video](./website/docs/public/agent-device-contacts.gif)](./website/docs/public/agent-device-contacts.mp4)

## Use Cases

- **QA**: explore flows, dogfood the app, run accessibility checks, capture evidence, and turn stable explorations into e2e tests.
- **Debugging**: start from a Sentry issue, crash during development, support ticket, or bug description. Reproduce the flow, inspect logs/network/perf data, and fix with context.
- **Development**: build from a product or engineering specification. Run the app, inspect the result, interact, debug, and iterate until the UI confirms the work.

## Get Started

Install the CLI.

```bash
npm install -g agent-device
```

Choose how to run it.

| Path | Best for | Start with |
| --- | --- | --- |
| Local | Simulators, emulators, physical devices, macOS apps, and Linux desktop targets. | Bring your own devices and wire `agent-device` into your agent workflow. |
| CI/CD | Smoke checks, replay suites, QA flows, debugging, and PR validation. | Use a ready setup for GitHub PRs, EAS builds, or CI validation. Coming soon. |
| Cloud | Linux runners, managed devices, and remote execution. | Use [Agent Device Cloud](https://agent-device.dev/cloud) or [contact Callstack](mailto:hello@callstack.com) for team-scale QA. |

## Command Flow

The canonical loop is:

```bash
# Find the app.
agent-device apps --platform ios

# Start a session.
agent-device open SampleApp --platform ios

# Inspect the current screen.
agent-device snapshot -i
# @e1 [heading] "Settings"
# @e2 [button] "Sign In"
# @e3 [text-field] "Email"

# Act on visible elements with press, fill, scroll, and more.
agent-device fill @e3 "test"

# Check what changed, then close the session.
agent-device diff snapshot -i
agent-device close
```

Refs shown in default snapshot output are actionable now. Hidden content is surfaced as scroll/list discovery hints; scroll and re-snapshot before acting on it.

In non-JSON mode, core mutating commands print a short success acknowledgment so agents and humans can distinguish successful actions from dropped or silent no-ops.

## Features

- Mobile, TV, and desktop coverage: iOS, Android, tvOS, Android TV, macOS, and Linux.
- Real device and simulator support.
- Token-efficient accessibility snapshots for agent loops.
- MIT licensed. Free to use.
- Automation, diffing, logging, debugging, network inspection, and profiling.
- React Native and Expo workflows, including React component tree inspection, props/state/hooks, and render profiling.
- Screenshots and video recordings.
- Replayable `.ad` scripts that turn exploration into e2e tests.
- Accessibility checks and dogfooding workflows.

## Used By

Used by teams and developers at Callstack, Expensify, [Shopify](https://x.com/mustafa01ali/status/2035155157982289998), [Kindred](https://x.com/sregg/status/2045231628369191075), Total Wine & More, [LegendList](https://x.com/jmeistrich/status/2036398735698305178), [HerLyfe](https://x.com/oliverbowman_), App & Flow, and more.

- [Oliver Bowman](https://x.com/oliverbowman_), HerLyfe: reduced the feedback loop in agentic workflows.
- [Jay Meistrich](https://x.com/jmeistrich/status/2036398735698305178), LegendList: used it for Android phone and iOS simulator testing while developing LegendList optimizations.

## Where To Go Next

For people:

- [Website](https://agent-device.dev/)
- [Docs](https://incubator.callstack.com/agent-device/docs/introduction)

For agents:

- [agent-device skill](skills/agent-device/SKILL.md)
- [react-devtools skill](skills/react-devtools/SKILL.md)
- [dogfood skill](skills/dogfood/SKILL.md)
- [agent-device skill on ClawHub](https://clawhub.ai/okwasniewski/agent-device)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
