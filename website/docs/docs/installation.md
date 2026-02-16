---
title: Installation
---

# Installation

## Global install

```bash
npm install -g agent-device
```

## Without installing

```bash
npx agent-device open Settings --platform ios
```

## Requirements

- Node.js 22+
- Xcode for iOS simulator/device automation (`simctl` + `devicectl`)
- Android SDK / ADB for Android

## iOS physical device prerequisites

- Device is paired and visible in `xcrun devicectl list devices`.
- Developer Mode enabled on device.
- Signing configured in Xcode (Automatic Signing recommended), or use:
- `AGENT_DEVICE_IOS_TEAM_ID`
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY`
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`
- If device setup is slow, increase daemon timeout:
  - `AGENT_DEVICE_DAEMON_TIMEOUT_MS=120000` (default is `45000`)
- If daemon startup reports stale metadata, remove stale files and retry:
  - `~/.agent-device/daemon.json`
  - `~/.agent-device/daemon.lock`
