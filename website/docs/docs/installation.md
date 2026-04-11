---
title: Installation
---

# Installation

## Global install

```bash
npm install -g agent-device
```

Interactive CLI runs periodically check for a newer published `agent-device` package in the background. When an upgrade is available, the CLI suggests reinstalling the package globally; that also refreshes the bundled `skills/` directory shipped with the release.

Set `AGENT_DEVICE_NO_UPDATE_NOTIFIER=1` to disable the notice.

## Without installing

```bash
npx agent-device open Settings --platform ios
```

## Requirements

- Node.js 22+
- Xcode for iOS simulator/device automation (`simctl` + `devicectl`)
- Android SDK / ADB for Android
- On macOS desktop targets, Swift 5.9+ / Xcode command-line tools are used to build the local `agent-device-macos-helper` on first use from source checkouts

## macOS desktop notes

- The macOS desktop path uses a local `agent-device-macos-helper` for permission checks (`settings permission ...`), alert handling, and helper-backed desktop snapshot surfaces (`frontmost-app`, `desktop`, `menubar`).
- Source checkouts build the helper lazily on first use and cache it under `~/.agent-device/macos-helper/current/`.
- Release distribution should ship a stable signed/notarized helper build so macOS trust/TCC state is tied to a durable code signature instead of an ad-hoc local binary.
- Local helper overrides through `AGENT_DEVICE_MACOS_HELPER_BIN` are intended for operators and packaged distributions; the value must be an absolute executable path.

## iOS physical device prerequisites

- Device is paired and visible in `xcrun devicectl list devices`.
- Developer Mode enabled on device.
- Signing configured in Xcode (Automatic Signing recommended), or use:
- `AGENT_DEVICE_IOS_TEAM_ID`
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY`
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`
- `AGENT_DEVICE_IOS_BUNDLE_ID` (optional runner bundle-id base override)
- Free Apple Developer (Personal Team) accounts can fail with "bundle identifier is not available" for generic IDs; set `AGENT_DEVICE_IOS_BUNDLE_ID` to a unique reverse-DNS value (for example `com.yourname.agentdevice.runner`).
- If device setup is slow, increase daemon timeout:
  - `AGENT_DEVICE_DAEMON_TIMEOUT_MS=120000` (default is `90000`)
- If daemon startup reports stale metadata, remove stale files and retry:
  - `<state-dir>/daemon.json`
  - `<state-dir>/daemon.lock`
  - default state dir is `~/.agent-device` unless `AGENT_DEVICE_STATE_DIR` or `--state-dir` is set
- Optional remote tenancy/lease controls:
  - `AGENT_DEVICE_MAX_SIMULATOR_LEASES=<n>`
  - `AGENT_DEVICE_LEASE_TTL_MS=<ms>`
  - `AGENT_DEVICE_LEASE_MIN_TTL_MS=<ms>`
  - `AGENT_DEVICE_LEASE_MAX_TTL_MS=<ms>`
