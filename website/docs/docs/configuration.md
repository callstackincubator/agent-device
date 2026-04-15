---
title: Configuration
---

# Configuration

Create an `agent-device.json` file to set persistent CLI defaults instead of repeating flags on every command.

## Config file locations

agent-device checks these sources in priority order:

| Priority | Location | Scope |
| --- | --- | --- |
| 1 (lowest) | `~/.agent-device/config.json` | User-level defaults |
| 2 | `./agent-device.json` | Project-level overrides |
| 3 | `AGENT_DEVICE_*` env vars | Override config values |
| 4 (highest) | CLI flags | Override everything |

Project-level values override user-level values. Environment variables override both. CLI flags always win.

Use `--config <path>` or `AGENT_DEVICE_CONFIG` to load one specific config file instead of the default locations.

## Config format

Config files use JSON objects with camelCase keys matching existing CLI flag names.

Environment variables follow the same fields using `AGENT_DEVICE_*` uppercase snake case names, for example:
- `session` -> `AGENT_DEVICE_SESSION`
- `daemonBaseUrl` -> `AGENT_DEVICE_DAEMON_BASE_URL`
- `iosSimulatorDeviceSet` -> `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET`
- `androidDeviceAllowlist` -> `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST`

When a CLI option has multiple flag aliases, config and environment sources use the canonical option value rather than a flag alias. Example:
- config: `"appsFilter": "user-installed"`
- env: `AGENT_DEVICE_APPS_FILTER=user-installed`
- not: `--user-installed`

Legacy compatibility env vars are still accepted for device scoping:
- `IOS_SIMULATOR_DEVICE_SET`
- `ANDROID_DEVICE_ALLOWLIST`

Example:

```json
{
  "platform": "ios",
  "device": "iPhone 16",
  "session": "qa-ios",
  "snapshotDepth": 3,
  "daemonBaseUrl": "http://127.0.0.1:4310/agent-device"
}
```

For non-loopback remote daemon URLs, also set `daemonAuthToken` or `AGENT_DEVICE_DAEMON_AUTH_TOKEN`. The client rejects non-loopback remote daemon URLs without auth.

Common keys include:
- `stateDir`
- `daemonBaseUrl`
- `daemonAuthToken`
- `daemonTransport`
- `daemonServerMode`
- `tenant`
- `sessionIsolation`
- `runId`
- `leaseId`
- `leaseBackend`
- `sessionLock`
- `sessionLocked`
- `sessionLockConflicts`
- `platform`
- `target`
- `device`
- `udid`
- `serial`
- `iosSimulatorDeviceSet`
- `androidDeviceAllowlist`
- `session`
- `verbose`
- `json`

Command-specific defaults are supported too, for example `snapshotDepth`, `snapshotScope`, `activity`, `relaunch`, `shutdown`, `fps`, `quality`, `stepsFile`, or `saveScript`.

Bound-session defaults use the same config and env mapping too:
- `sessionLock` -> `AGENT_DEVICE_SESSION_LOCK`
- `sessionLocked` -> `AGENT_DEVICE_SESSION_LOCKED`
- `sessionLockConflicts` -> `AGENT_DEVICE_SESSION_LOCK_CONFLICTS`

## Command-specific defaults

Command-specific keys are applied only when the current command supports them.

Examples:
- A default `snapshotDepth` applies to `snapshot`, `diff snapshot`, `click`, `fill`, `get`, `wait`, `find`, and `is`.
- The same `snapshotDepth` value is ignored for commands like `open`, `close`, or `devices`.

This keeps one shared config file usable across different command families.

## Failure behavior

- If `--config` or `AGENT_DEVICE_CONFIG` points to a missing file, agent-device fails during CLI parse before contacting the daemon.
- Invalid JSON, unknown keys, or invalid values in config files also fail during CLI parse with `INVALID_ARGS`.
