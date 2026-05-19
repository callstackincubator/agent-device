# Configuration

Create an `agent-device.json` file to set persistent CLI defaults instead of repeating flags on every command.

## Config file locations

agent-device checks these sources in priority order:

| Priority    | Location                      | Scope                   |
| ----------- | ----------------------------- | ----------------------- |
| 1 (lowest)  | `~/.agent-device/config.json` | User-level defaults     |
| 2           | `./agent-device.json`         | Project-level overrides |
| 3           | `AGENT_DEVICE_*` env vars     | Override config values  |
| 4 (highest) | CLI flags                     | Override everything     |

Project-level values override user-level values. Environment variables override both. CLI flags always win.

Use `--config <path>` or `AGENT_DEVICE_CONFIG` to load one specific config file instead of the default locations.

## Config format

Config files use JSON objects with camelCase keys matching existing CLI flag names.

Environment variables follow the same fields using `AGENT_DEVICE_*` uppercase snake case names, for example:

- `session` -> `AGENT_DEVICE_SESSION`
- `daemonBaseUrl` -> `AGENT_DEVICE_DAEMON_BASE_URL`
- `iosSimulatorDeviceSet` -> `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET`
- `androidDeviceAllowlist` -> `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST`

Config and environment sources use canonical option values rather than CLI flag names. Example:

- config: `"appsFilter": "user-installed"`
- env: `AGENT_DEVICE_APPS_FILTER=user-installed`
- CLI equivalent: omit `--all`

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

`install-from-source` can also read a structured GitHub Actions artifact source from config when a compatible remote daemon resolves CI artifacts server-side:

```json
{
  "platform": "android",
  "installSource": {
    "type": "github-actions-artifact",
    "repo": "thymikee/RNCLI83",
    "artifact": "rn-android-emulator-debug-pr-19"
  }
}
```

Use a numeric `artifact` value for an artifact ID. Use a string `artifact` value for an artifact name.

Bound-session defaults use the same config and env mapping too:

- `sessionLock` -> `AGENT_DEVICE_SESSION_LOCK`

Older bound-session lock aliases remain accepted for compatibility, but new configs and automation should use `sessionLock`, `--session-lock`, or `AGENT_DEVICE_SESSION_LOCK`.

## Environment variable inventory

Public env vars are supported configuration points for users, CI operators, or remote daemon deployments. Compatibility aliases remain accepted for old scripts but should not be used in new workflow guidance. Internal env vars are test, packaging, runner, or debug controls and are intentionally not part of the supported user surface.

| Category                   | Env vars                                                                                                                                                                                                                                                                                    | Decision                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| CLI defaults and config    | `AGENT_DEVICE_CONFIG`, `AGENT_DEVICE_SESSION`, `AGENT_DEVICE_PLATFORM`, `AGENT_DEVICE_SESSION_LOCK`, `AGENT_DEVICE_DAEMON_BASE_URL`, `AGENT_DEVICE_DAEMON_AUTH_TOKEN`, `AGENT_DEVICE_CLOUD_BASE_URL`, `AGENT_DEVICE_APPS_FILTER`                                                            | Public                                                                                        |
| Device scoping             | `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET`, `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST`                                                                                                                                                                                                            | Public                                                                                        |
| Remote daemon and tenancy  | `AGENT_DEVICE_STATE_DIR`, `AGENT_DEVICE_DAEMON_SERVER_MODE`, `AGENT_DEVICE_DAEMON_PORT`, `AGENT_DEVICE_DAEMON_HTTP_PORT`, `AGENT_DEVICE_HTTP_AUTH_HOOK`, `AGENT_DEVICE_MAX_SIMULATOR_LEASES`, `AGENT_DEVICE_LEASE_TTL_MS`, `AGENT_DEVICE_LEASE_MIN_TTL_MS`, `AGENT_DEVICE_LEASE_MAX_TTL_MS` | Public operator controls                                                                      |
| Metro and install helpers  | `AGENT_DEVICE_METRO_BEARER_TOKEN`, `AGENT_DEVICE_BUNDLETOOL_JAR`, `AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE`                                                                                                                                                                                    | Public                                                                                        |
| App hooks and logs         | `AGENT_DEVICE_APP_EVENT_URL_TEMPLATE`, `AGENT_DEVICE_IOS_APP_EVENT_URL_TEMPLATE`, `AGENT_DEVICE_MACOS_APP_EVENT_URL_TEMPLATE`, `AGENT_DEVICE_ANDROID_APP_EVENT_URL_TEMPLATE`, `AGENT_DEVICE_APP_LOG_MAX_BYTES`, `AGENT_DEVICE_APP_LOG_MAX_FILES`, `AGENT_DEVICE_APP_LOG_REDACT_PATTERNS`    | Public                                                                                        |
| Apple runner setup         | `AGENT_DEVICE_IOS_TEAM_ID`, `AGENT_DEVICE_IOS_SIGNING_IDENTITY`, `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`, `AGENT_DEVICE_IOS_BUNDLE_ID`, `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH`, `AGENT_DEVICE_IOS_CLEAN_DERIVED`                                                                            | Public operator controls. Cleanup is only automatic for override paths under project `.tmp/`. |
| Compatibility aliases      | `AGENT_DEVICE_SESSION_LOCKED`, `AGENT_DEVICE_SESSION_LOCK_CONFLICTS`, `AGENT_DEVICE_PROXY_TOKEN`, `IOS_SIMULATOR_DEVICE_SET`, `ANDROID_DEVICE_ALLOWLIST`                                                                                                                                    | Keep accepted, hide from new guidance                                                         |
| CI, tests, and diagnostics | `AGENT_DEVICE_TEST_*`, `AGENT_DEVICE_REQUIRE_LOOPBACK_TESTS`, `AGENT_DEVICE_RECORDING_E2E`, `AGENT_DEVICE_STRICT_FLAGS`, `AGENT_DEVICE_RETRY_LOGS`, `AGENT_DEVICE_XCUITEST_*`, `AGENT_DEVICE_RUNNER_*`, `AGENT_DEVICE_COMPANION_TUNNEL_*`, iOS/runner timeout env vars                      | Internal                                                                                      |
| Removed                    | `AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN`                                                                                                                                                                                                                                             | Removed; use project `.tmp/` derived paths for cleanable overrides                            |

## Command-specific defaults

Command-specific keys are applied only when the current command supports them.

Examples:

- A default `snapshotDepth` applies to `snapshot`, `diff snapshot`, `click`, `fill`, `get`, `wait`, `find`, and `is`.
- The same `snapshotDepth` value is ignored for commands like `open`, `close`, or `devices`.

This keeps one shared config file usable across different command families.

## Failure behavior

- If `--config` or `AGENT_DEVICE_CONFIG` points to a missing file, agent-device fails during CLI parse before contacting the daemon.
- Invalid JSON, unknown keys, or invalid values in config files also fail during CLI parse with `INVALID_ARGS`.
