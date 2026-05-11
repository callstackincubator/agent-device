# Agent-native app automation for mobile, TV, and desktop.

> agent-device is a token-efficient CLI for AI mobile testing, React Native QA, Expo app verification, iOS Simulator automation, Android Emulator automation, and app observability from coding agents. It gives agents structured UI access, deterministic interactions, and built-in logs, network inspection, CPU/memory/perf metrics, and replay when the happy path breaks.

[Get Started](/docs/agent-setup) | [Commands](/docs/commands)

## Features

- **One CLI, many app surfaces**: Control iOS, Android, tvOS, Android TV, macOS, and Linux desktop targets with consistent snapshot and interaction commands.
- **Accessibility-first snapshots**: Accessibility trees give agents compact UI context without forcing screenshot-only reasoning.
- **Agent-native interactions**: Tap, swipe, scroll, focus, type, assert, and find visible UI through refs, selectors, and semantic finders.
- **Built-in observability**: Collect session logs, inspect recent HTTP traffic, capture screenshots and recordings, and sample CPU, memory, startup, and frame-health metrics.
- **Session and replay**: Open apps, keep stateful context, and replay recorded `.ad` actions to reproduce flows without AI at runtime.
- **Thin MCP router**: MCP provides install, status, and version-matched help discovery while automation stays explicit through CLI commands.
- **React Native internals**: Use agent-device react-devtools to inspect React Native component trees, props, state, hooks, and render profiles through pinned agent-react-devtools.
