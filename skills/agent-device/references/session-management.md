# Session Management

## Named sessions

```bash
agent-device --session auth open Settings --platform ios
agent-device --session auth snapshot -i
```

Sessions isolate device context. A device can only be held by one session at a time.

## Best practices

- Name sessions semantically.
- Close sessions when done.
- Use separate sessions for parallel work.
- For orchestrated QA runs, prefer a pre-bound session/platform over repeating per-command selectors.
- For remote tenant-scoped automation, run commands with:
  `--tenant <id> --session-isolation tenant --run-id <id> --lease-id <id>`
- In iOS sessions, use `open <app>`. `open <url>` opens deep links; on devices `http(s)://` opens Safari when no app is active, and custom schemes require an active app in the session.
- In iOS sessions, `open <app> <url>` opens a deep link.
- On iOS, `appstate` is session-scoped and requires a matching active session on the target device.
- For dev loops where runtime state can persist (for example React Native Fast Refresh), use `open <app> --relaunch` to restart the app process in the same session.
- Use `--save-script [path]` to record replay scripts on `close`; path is a file path and parent directories are created automatically.
- Use `close --shutdown` on iOS simulators or Android emulators to shut down the target as part of session teardown, preventing resource leakage in multi-tenant or CI workloads.
- For ambiguous bare `--save-script` values, prefer `--save-script=workflow.ad` or `./workflow.ad`.
- For deterministic replay scripts, prefer selector-based actions and assertions.
- Use `replay -u` to update selector drift during maintenance.

## Session-bound automation

Use this when an external orchestrator must keep every CLI call on the same session/device without a wrapper script.

```bash
export AGENT_DEVICE_SESSION=qa-ios
export AGENT_DEVICE_PLATFORM=ios
export AGENT_DEVICE_SESSION_LOCK=strip

agent-device open MyApp --relaunch
agent-device snapshot -i
agent-device press @e3
agent-device close
```

- `AGENT_DEVICE_SESSION` and `AGENT_DEVICE_PLATFORM` provide the default binding when `--session` and `--platform` are omitted.
- A configured `AGENT_DEVICE_SESSION` enables lock policy enforcement by convention. The default mode is `reject`.
- `--session-lock reject|strip` or `AGENT_DEVICE_SESSION_LOCK=reject|strip` controls whether conflicting selectors fail or are ignored.
- Conflicts include explicit retargeting selectors such as `--platform`, `--target`, `--device`, `--udid`, `--serial`, `--ios-simulator-device-set`, and `--android-device-allowlist`.
- `--session-locked`, `--session-lock-conflicts`, `AGENT_DEVICE_SESSION_LOCKED`, and `AGENT_DEVICE_SESSION_LOCK_CONFLICTS` remain supported as compatibility aliases.
- Lock policy applies to nested `batch` steps too. If a step omits `platform`, it still inherits the parent batch `--platform` instead of being silently replaced by an environment default.

## Scoped device isolation

Use scoped discovery when sessions must not see host-global device lists.

```bash
agent-device devices --platform ios --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device devices --platform android --android-device-allowlist emulator-5554,device-1234
```

- Scope is applied before selectors (`--device`, `--udid`, `--serial`).
- If selector target is outside scope, resolution fails with `DEVICE_NOT_FOUND`.
- If the scoped iOS simulator set is empty (first-run), the error includes the set path and a suggested `xcrun simctl --set <path> create ...` command.
- With iOS simulator-set scope enabled, iOS physical devices are not enumerated.
- Environment equivalents:
  - `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET` (compat: `IOS_SIMULATOR_DEVICE_SET`)
  - `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST` (compat: `ANDROID_DEVICE_ALLOWLIST`)

## Listing sessions

```bash
agent-device session list
```

iOS session entries include `device_udid` and `ios_simulator_device_set` (null when using the default set). Use these fields to confirm device routing in concurrent multi-session runs without additional `simctl` calls.

## Replay within sessions

```bash
agent-device replay ./session.ad --session auth
agent-device replay -u ./session.ad --session auth
```

## Tenant isolation note

When session isolation is set to tenant mode, session namespace is scoped as
`<tenant>:<session>`. For remote runs, allocate and maintain an active lease
for the same tenant/run scope before executing tenant-isolated commands.
