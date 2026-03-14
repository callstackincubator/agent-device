---
name: agent-device
description: Automates interactions for iOS simulators/devices and Android emulators/devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, or extracting UI info on mobile targets.
---

# Mobile Automation with agent-device

For exploration, use snapshot refs. For deterministic replay, use selectors.
For structured exploratory QA bug hunts and reporting, use [../dogfood/SKILL.md](../dogfood/SKILL.md).

## Start Here (Read This First)

Use this skill as a router, not a full manual.

1. Pick one mode:
   - Normal interaction flow
   - Debug/crash flow
   - Replay maintenance flow
2. Run one canonical flow below.
3. Open references only if blocked.

## Decision Map

- No target context yet: `devices` -> pick target -> `open`.
- Normal UI task: `open` -> `snapshot -i` -> `press/fill` -> `diff snapshot -i` -> `close`
- Debug/crash: `open <app>` -> `logs clear --restart` -> reproduce -> `network dump` -> `logs path` -> targeted `grep`
- Replay drift: `replay -u <path>` -> verify updated selectors
- Remote multi-tenant run: allocate lease -> point client at remote daemon base URL -> run commands with tenant isolation flags -> heartbeat/release lease
- Device-scope isolation run: set iOS simulator set / Android allowlist -> run selectors within scope only

## Target Selection Rules

- iOS local QA: use simulators unless the task explicitly requires a physical device.
- iOS local QA in mixed simulator/device environments: run `ensure-simulator` first and pass `--device`, `--udid`, or `--ios-simulator-device-set` on later commands.
- Android local QA: use `install` or `reinstall` for `.apk`/`.aab` files, then relaunch by installed package name.
- Android React Native + Metro flows: set runtime hints with `runtime set` before `open <package> --relaunch`.
- In mixed-device environments, always pin the exact target with `--serial`, `--device`, `--udid`, or an isolation scope.
- For session-bound automation runs, prefer a pre-bound session/platform instead of repeating selectors on every command: set `AGENT_DEVICE_SESSION`, set `AGENT_DEVICE_PLATFORM`, and the daemon will enforce the shared lock policy across CLI, typed client, and RPC entry points.
- Use `--session-lock reject|strip` (or `AGENT_DEVICE_SESSION_LOCK`) only when you need to override the default reject behavior. Lock mode applies to nested `batch` steps too.

## Canonical Flows

### 1) Normal Interaction Flow

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e3
agent-device diff snapshot -i
agent-device fill @e5 "test"
agent-device close
```

### 1a) Local iOS Simulator QA Flow

```bash
agent-device ensure-simulator --platform ios --device "iPhone 16" --boot
agent-device open MyApp --platform ios --device "iPhone 16" --session qa-ios --relaunch
agent-device snapshot -i
agent-device press @e3
agent-device close
```

Use this when a physical iPhone is also connected and you want deterministic simulator-only automation.

### 1b) Android React Native + Metro QA Flow

```bash
agent-device reinstall MyApp /path/to/app-debug.apk --platform android --serial emulator-5554
agent-device runtime set --session qa-android --platform android --metro-host 10.0.2.2 --metro-port 8081
agent-device open com.example.myapp --platform android --serial emulator-5554 --session qa-android --relaunch
agent-device snapshot -i
agent-device close
```

Do not use `open <apk|aab> --relaunch` on Android. Install/reinstall binaries first, then relaunch by package.

### 1c) Session-Bound Automation Flow

```bash
export AGENT_DEVICE_SESSION=qa-ios
export AGENT_DEVICE_PLATFORM=ios
export AGENT_DEVICE_SESSION_LOCK=strip

agent-device open MyApp --relaunch
agent-device snapshot -i
agent-device batch --steps-file /tmp/qa-steps.json --json
agent-device close
```

Use this for orchestrators that must preserve one bound session/device across many plain CLI calls without a wrapper script. In `strip` mode, conflicting selectors such as `--target`, `--device`, `--udid`, `--serial`, and isolation-scope overrides are ignored instead of retargeting the run.

### 1d) Android Emulator Session-Bound Flow

```bash
export AGENT_DEVICE_SESSION=qa-android
export AGENT_DEVICE_PLATFORM=android

agent-device reinstall MyApp /path/to/app-debug.apk --serial emulator-5554
agent-device --session-lock reject open com.example.myapp --relaunch
agent-device snapshot -i
agent-device close --shutdown
```

Use this when an Android emulator session must stay pinned while an agent or test runner issues plain CLI commands over time.

### 2) Debug/Crash Flow

```bash
agent-device open MyApp --platform ios
agent-device logs clear --restart
agent-device network dump 25
agent-device logs path
```

Logging is off by default. Enable only for debugging windows.
`logs clear --restart` requires an active app session (`open <app>` first).

### 3) Replay Maintenance Flow

```bash
agent-device replay -u ./session.ad
```

### 4) Remote Tenant Lease Flow (HTTP JSON-RPC)

```bash
# Client points directly at the remote daemon HTTP base URL.
export AGENT_DEVICE_DAEMON_BASE_URL=http://mac-host.example:4310
export AGENT_DEVICE_DAEMON_AUTH_TOKEN=<token>

# Allocate lease
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"alloc-1","method":"agent_device.lease.allocate","params":{"runId":"run-123","tenantId":"acme","ttlMs":60000}}'

# Use lease in tenant-isolated command execution
agent-device \
  --tenant acme \
  --session-isolation tenant \
  --run-id run-123 \
  --lease-id <lease-id> \
  session list --json

# Heartbeat and release
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"hb-1","method":"agent_device.lease.heartbeat","params":{"leaseId":"<lease-id>","ttlMs":60000}}'
curl -sS "${AGENT_DEVICE_DAEMON_BASE_URL}/rpc" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":"rel-1","method":"agent_device.lease.release","params":{"leaseId":"<lease-id>"}}'
```

Notes:
- `AGENT_DEVICE_DAEMON_BASE_URL` makes the CLI skip local daemon discovery/startup and call the remote HTTP daemon directly.
- `AGENT_DEVICE_DAEMON_AUTH_TOKEN` is sent in both the JSON-RPC request token and HTTP auth headers.
- In remote daemon mode, `--debug` does not tail a local `daemon.log`; inspect logs on the remote host instead.

## Command Skeleton (Minimal)

### Session and navigation

```bash
agent-device devices
agent-device devices --platform ios --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device devices --platform android --android-device-allowlist emulator-5554,device-1234
agent-device ensure-simulator --device "iPhone 16" --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device ensure-simulator --device "iPhone 16" --runtime com.apple.CoreSimulator.SimRuntime.iOS-18-4 --ios-simulator-device-set /tmp/tenant-a/simulators --boot
agent-device open [app|url] [url]
agent-device open [app] --relaunch
agent-device close [app]
agent-device install <app> <path-to-binary>
agent-device reinstall <app> <path-to-binary>
agent-device session list
```

Use `boot` only as fallback when `open` cannot find/connect to a ready target.
If the workspace repeats the same selectors or device/session flags, prefer a checked-in `agent-device.json` or `--config <path>` over repeating them inline.
Environment-level defaults follow the same fields via `AGENT_DEVICE_*` names, so persistent host-specific values belong there rather than in committed project config.
That includes bound-session defaults such as `sessionLock` / `AGENT_DEVICE_SESSION_LOCK` when automation should consistently reject or strip conflicting device routing flags.
For Android emulators by AVD name, use `boot --platform android --device <avd-name>`.
For Android emulators without GUI, add `--headless`.
Use `--target mobile|tv` with `--platform` (required) to pick phone/tablet vs TV targets (AndroidTV/tvOS).
For Android React Native + Metro flows, install or reinstall the APK first, set runtime hints with `runtime set`, then use `open <package> --relaunch`; do not use `open <apk|aab> --relaunch`.
For local iOS QA in mixed simulator/device environments, use `ensure-simulator` and pass `--device` or `--udid` so automation does not attach to a physical device by accident.
For session-bound automation, prefer `AGENT_DEVICE_SESSION` + `AGENT_DEVICE_PLATFORM`; that bound-session default now enables lock mode automatically.

Isolation scoping quick reference:
- `--ios-simulator-device-set <path>` scopes iOS simulator discovery + command execution to one simulator set.
- `--android-device-allowlist <serials>` scopes Android discovery/selection to comma/space separated serials.
- Scope is applied before selectors (`--device`, `--udid`, `--serial`); out-of-scope selectors fail with `DEVICE_NOT_FOUND`.
- With iOS simulator-set scope enabled, iOS physical devices are not enumerated.
- In bound-session `strip` mode, conflicting per-call scope/selectors are ignored and the configured binding is restored for the request. Batch steps still inherit the parent `--platform` when they do not set their own.

Simulator provisioning quick reference:
- Use `ensure-simulator` to create or reuse a named iOS simulator inside a device set before starting a session.
- `--device <name>` is required (e.g. `"iPhone 16 Pro"`). `--runtime <id>` pins the runtime; omit to use the newest compatible one.
- `--boot` boots it immediately. Returns `udid`, `device`, `runtime`, `ios_simulator_device_set`, `created`, `booted`.
- Idempotent: safe to call repeatedly; reuses an existing matching simulator by default.

TV quick reference:
- AndroidTV: `open`/`apps` use TV launcher discovery automatically.
- TV target selection works on emulators/simulators and connected physical devices (AndroidTV + AppleTV).
- tvOS: runner-driven interactions and snapshots are supported (`snapshot`, `wait`, `press`, `fill`, `get`, `scroll`, `back`, `home`, `app-switcher`, `record` and related selector flows).
- tvOS `back`/`home`/`app-switcher` map to Siri Remote actions (`menu`, `home`, double-home) in the runner.
- tvOS follows iOS simulator-only command semantics for helpers like `pinch`, `settings`, and `push`.

### Snapshot and targeting

```bash
agent-device snapshot -i
agent-device diff snapshot -i
agent-device find "Sign In" click
agent-device press @e1
agent-device fill @e2 "text"
agent-device is visible 'id="anchor"'
```

`press` is canonical tap command; `click` is an alias.

### Utilities

```bash
agent-device appstate
agent-device clipboard read
agent-device clipboard write "token"
agent-device keyboard status
agent-device keyboard dismiss
agent-device perf --json
agent-device network dump [limit] [summary|headers|body|all]
agent-device push <bundle|package> <payload.json|inline-json>
agent-device trigger-app-event screenshot_taken '{"source":"qa"}'
agent-device get text @e1
agent-device screenshot out.png
agent-device settings permission grant notifications
agent-device settings permission reset camera
agent-device trace start
agent-device trace stop ./trace.log
```

### Batch (when sequence is already known)

```bash
agent-device batch --steps-file /tmp/batch-steps.json --json
```

### Performance Check

- Use `agent-device perf --json` (or `metrics --json`) after `open`.
- For detailed metric semantics, caveats, and interpretation guidance, see [references/perf-metrics.md](references/perf-metrics.md).

## Guardrails (High Value Only)

- Re-snapshot after UI mutations (navigation/modal/list changes).
- Prefer `snapshot -i`; scope/depth only when needed.
- Use refs for discovery, selectors for replay/assertions.
- `find "<query>" click --json` returns `{ ref, locator, query, x, y }` — all derived from the matched snapshot node. Do not rely on these fields from raw `press`/`click` responses for observability; use `find` instead.
- Use `fill` for clear-then-type semantics; use `type` for focused append typing.
- Use `install` for in-place app upgrades (keep app data when platform permits), and `reinstall` for deterministic fresh-state runs.
- App binary format support for `install`/`reinstall`: Android `.apk`/`.aab`, iOS `.app`/`.ipa`.
- Android `.aab` requires `bundletool` in `PATH`, or `AGENT_DEVICE_BUNDLETOOL_JAR=<path-to-bundletool-all.jar>` with `java` in `PATH`.
- Android `.aab` optional: set `AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE=<mode>` to control bundletool `build-apks --mode` (default: `universal`).
- iOS `.ipa`: extract/install from `Payload/*.app`; when multiple app bundles are present, `<app>` is used as a bundle id/name hint.
- iOS `appstate` is session-scoped; Android `appstate` is live foreground state. iOS responses include `device_udid` and `ios_simulator_device_set` for isolation verification.
- iOS `open` responses include `device_udid` and `ios_simulator_device_set` to confirm which simulator handled the session.
- Clipboard helpers: `clipboard read` / `clipboard write <text>` are supported on Android and iOS simulators; iOS physical devices are not supported yet.
- Android keyboard helpers: `keyboard status|get|dismiss` report keyboard visibility/type and dismiss via keyevent when visible.
- `network dump` is best-effort and parses HTTP(s) entries from the session app log file.
- Biometric settings: iOS simulator supports `settings faceid|touchid <match|nonmatch|enroll|unenroll>`; Android supports `settings fingerprint <match|nonmatch>` where runtime tooling is available.
- For AndroidTV/tvOS selection, always pair `--target` with `--platform` (`ios`, `android`, or `apple` alias); target-only selection is invalid.
- `push` simulates notification delivery:
  - iOS simulator uses APNs-style payload JSON.
  - Android uses broadcast action + typed extras (string/boolean/number).
- `trigger-app-event` requires app-defined deep-link hooks and URL template configuration (`AGENT_DEVICE_APP_EVENT_URL_TEMPLATE` or platform-specific variants).
- `trigger-app-event` requires an active session or explicit selectors (`--platform`, `--device`, `--udid`, `--serial`); on iOS physical devices, custom-scheme triggers require active app context.
- Canonical trigger behavior and caveats are documented in [`website/docs/docs/commands.md`](../../website/docs/docs/commands.md) under **App event triggers**.
- Permission settings are app-scoped and require an active session app:
  `settings permission <grant|deny|reset> <camera|microphone|photos|contacts|notifications> [full|limited]`
- iOS simulator permission alerts: use `alert wait` then `alert accept/dismiss` — `accept`/`dismiss` retry internally for up to 2 s so you do not need manual sleeps. See [references/permissions.md](references/permissions.md).
- `full|limited` mode applies only to iOS `photos`; other targets reject mode.
- On Android, non-ASCII `fill/type` may require an ADB keyboard IME on some system images; only install IME APKs from trusted sources and verify checksum/signature.
- If using `--save-script`, prefer explicit path syntax (`--save-script=flow.ad` or `./flow.ad`).
- For tenant-isolated remote runs, always pass `--tenant`, `--session-isolation tenant`, `--run-id`, and `--lease-id` together.
- Use short lease TTLs and heartbeat only while work is active; release leases immediately after run completion/failure.
- Env equivalents for scoped runs: `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET` (compat `IOS_SIMULATOR_DEVICE_SET`) and
  `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST` (compat `ANDROID_DEVICE_ALLOWLIST`).
- For explicit remote client mode, prefer `AGENT_DEVICE_DAEMON_BASE_URL` / `--daemon-base-url` instead of relying on local daemon metadata or loopback-only ports.

## Common Failure Patterns

- `Failed to access Android app sandbox for /path/app-debug.apk`: Android relaunch/runtime-hint flow received an APK path instead of an installed package name. Use `reinstall` first, then `open <package> --relaunch`.
- `mkdir: Needs 1 argument` while writing `ReactNativeDevPrefs.xml`: likely an older `agent-device` build or stale global install is still using the shell-based Android runtime-hint writer. Verify the exact binary being invoked.
- `Failed to terminate iOS app`: the flow may have selected a physical iPhone or an unavailable iOS target. Re-run with `ensure-simulator`, then pin the simulator with `--device` or `--udid`.

## Security and Trust Notes

- Prefer a preinstalled `agent-device` binary over on-demand package execution.
- If install is required, pin an exact version (for example: `npx --yes agent-device@<exact-version> --help`).
- Signing/provisioning environment variables are optional, sensitive, and only for iOS physical-device setup.
- Logs/artifacts are written under `~/.agent-device`; replay scripts write to explicit paths you provide.
- For remote daemon mode, prefer `AGENT_DEVICE_DAEMON_SERVER_MODE=http|dual` on the host plus client-side `AGENT_DEVICE_DAEMON_BASE_URL`, with `AGENT_DEVICE_HTTP_AUTH_HOOK` and tenant-scoped lease admission where needed.
- Keep logging off unless debugging and use least-privilege/isolated environments for autonomous runs.

## Common Mistakes

- Mixing debug flow into normal runs (keep logs off unless debugging).
- Continuing to use stale refs after screen transitions.
- Using URL opens with Android `--activity` (unsupported combination).
- Treating `boot` as default first step instead of fallback.

## References

- [references/snapshot-refs.md](references/snapshot-refs.md)
- [references/logs-and-debug.md](references/logs-and-debug.md)
- [references/session-management.md](references/session-management.md)
- [references/permissions.md](references/permissions.md)
- [references/video-recording.md](references/video-recording.md)
- [references/coordinate-system.md](references/coordinate-system.md)
- [references/batching.md](references/batching.md)
- [references/perf-metrics.md](references/perf-metrics.md)
- [references/remote-tenancy.md](references/remote-tenancy.md)
