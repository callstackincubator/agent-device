<a href="https://www.callstack.com/open-source?utm_campaign=generic&utm_source=github&utm_medium=referral&utm_content=agent-device" align="center">
  <picture>
    <img alt="agent-device: device automation CLI for AI agents" src="website/docs/public/agent-device-banner.jpg">
  </picture>
</a>

---

# agent-device

[![npm version](https://img.shields.io/npm/v/agent-device.svg)](https://www.npmjs.com/package/agent-device)
[![CI](https://github.com/callstackincubator/agent-device/actions/workflows/ci.yml/badge.svg)](https://github.com/callstackincubator/agent-device/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

Device automation CLI for AI agents. Mobile, TV, and desktop apps.

`agent-device` lets coding agents run real apps, inspect UI state, interact with visible elements, and collect debugging evidence through one CLI.

It is built around token-efficient accessibility snapshots, not pixel-first screenshots. Agents read compact UI trees, locate elements through refs like `@e3`, perform touch and text actions, and capture screenshots, video, logs, network, perf, and React profiles only when evidence is needed.

## Agentic QA And Development

- **Quality Assurance**: dogfood flows, validate PR builds, check accessibility coverage, capture evidence, and turn stable explorations into `.ad` e2e tests.
- **Development**: build from specs, reproduce crashes and support issues, inspect logs/network/perf data, and iterate until the UI matches the work.

If you know Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser), this is the same idea for apps and devices.

![agent-device demo showing an agent inspecting and interacting with a contacts app](./website/docs/public/agent-device-contacts.gif)

## Quick Start

Install the CLI first:

```bash
npm install -g agent-device
agent-device --version
agent-device help workflow
```

The CLI help is the source of truth for agents and is shipped with the installed version. Skills are optional but recommended when your agent runtime supports them: they auto-route device, React DevTools, and dogfood tasks to the right `agent-device help <topic>` page and verify the CLI is new enough before acting.

If you install skills separately, keep the CLI on `agent-device >= 0.14.0`. Older CLIs do not include the workflow help topics that the router skills expect.

```bash
npm install -g agent-device@latest
agent-device --version
agent-device help
```

`agent-device` performs a lightweight background upgrade check for interactive CLI runs and, when a newer package is available, suggests a global reinstall command. Updating the package also refreshes the bundled `skills/` shipped with the CLI.

Prerequisites: Node.js 22+, Xcode for iOS/tvOS/macOS targets, Android SDK + ADB for Android, and macOS Accessibility permission for desktop automation. See [Installation](https://incubator.callstack.com/agent-device/docs/installation).

Try the loop.

```bash
# Find the app.
agent-device apps --platform ios

# Start a session.
agent-device open SampleApp --platform ios

# Inspect the current screen. -i returns interactive elements only.
agent-device snapshot -i
# @e1 [heading] "Settings"
# @e2 [button] "Sign In"
# @e3 [text-field] "Email"

# Act, capture a screenshot, and close.
agent-device fill @e3 "test"
agent-device screenshot ./artifacts/settings.png
agent-device close
```

Snapshots assign refs like `@e1`, `@e2`, and `@e3` to current-screen elements. Refs from the default snapshot are immediately actionable; for hidden content, scroll and re-snapshot.

## Where To Run agent-device

| Path | Best for | Start with |
| --- | --- | --- |
| Local | Exploration, debugging, and development loops on simulators, emulators, physical devices, macOS apps, and Linux desktop targets. | Follow the Quick Start. |
| CI/CD | Automated PR and merge validation with replay scripts and captured artifacts. | Start with the [EAS workflow template](https://github.com/callstackincubator/eas-agent-device/blob/main/.eas/workflows/agent-qa-mobile.yml). GitHub Actions template coming soon. |
| Cloud | Linux runners, managed devices, and remote execution. | Use [Agent Device Cloud](https://agent-device.dev/cloud) or [contact Callstack](mailto:hello@callstack.com) for team-scale QA. |

## Capabilities

- **Platforms**: iOS, Android, tvOS, Android TV, macOS, and Linux. Real devices and simulators are supported.
- **Capture**: screenshots, video, logs, network traffic, performance data, accessibility snapshots, and React render profiles.
- **Produce**: replayable `.ad` scripts (recorded replay files that run locally or in CI), e2e test runs, snapshot and screenshot diffs, and debugging artifacts.
- **React Native and Expo**: component tree inspection, props/state/hooks, and render profiling.
- **License**: MIT. Free to use.

## How It Works

`agent-device` runs session-aware commands through platform backends: XCTest for iOS and tvOS, ADB plus the Android snapshot helper for Android, a local helper for macOS desktop automation, and AT-SPI for Linux desktop targets. See [Introduction](https://incubator.callstack.com/agent-device/docs/introduction) and [Commands](https://incubator.callstack.com/agent-device/docs/commands) for platform details.

Node consumers can use the typed client and public subpaths for bridge integrations. `agent-device/android-adb` exposes the Android ADB provider contract, logcat/clipboard/keyboard/app helpers, and port reverse management.

## Used By

Used by teams and developers at Callstack, Expensify, Shopify, Kindred, Total Wine & More, LegendList, HerLyfe, App & Flow, and more.

## Documentation

- [Installation](https://incubator.callstack.com/agent-device/docs/installation)
- [Typed Client](https://incubator.callstack.com/agent-device/docs/client-api)
- [Commands](https://incubator.callstack.com/agent-device/docs/commands)
- [Replay & E2E](https://incubator.callstack.com/agent-device/docs/replay-e2e)
- [Known limitations](https://incubator.callstack.com/agent-device/docs/known-limitations)

Agent integration:

- [agent-device skill](skills/agent-device/SKILL.md)
- [react-devtools skill](skills/react-devtools/SKILL.md)
- [dogfood skill](skills/dogfood/SKILL.md)
- [agent-device skill on ClawHub](https://clawhub.ai/okwasniewski/agent-device)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Made at Callstack

agent-device is open source and MIT licensed. Try the [EAS workflow template](https://github.com/callstackincubator/eas-agent-device/blob/main/.eas/workflows/agent-qa-mobile.yml), use [Agent Device Cloud](https://agent-device.dev/cloud), or contact us at hello@callstack.com.
