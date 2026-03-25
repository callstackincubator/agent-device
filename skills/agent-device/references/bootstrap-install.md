# Bootstrap and Install

## When to open this file

Open this file when you still need to choose the right target, start the right session, install or relaunch the app, or pin automation to one device before interacting.

## Main commands to reach for first

- `devices`
- `ensure-simulator`
- `open`
- `install` or `reinstall`
- `close`
- `session list`

## Most common mistake to avoid

Do not start acting before you have pinned the correct target and opened an `app` session. In mixed-device environments, always pass `--device`, `--udid`, or `--serial`.

## Canonical loop

```bash
agent-device ensure-simulator --platform ios --device "iPhone 17 Pro" --boot
agent-device open MyApp --platform ios --device "iPhone 17 Pro" --relaunch
agent-device snapshot -i
agent-device close
```

## Choose the right starting point

- iOS local QA: prefer simulators unless the task explicitly requires physical hardware.
- iOS in mixed simulator and device environments: run `ensure-simulator` first, then keep using `--device` or `--udid`.
- TV targets: use `--target tv` together with `--platform` when the task is for tvOS or Android TV rather than phone or tablet surfaces.
- Android binary flow: use `install` or `reinstall` for `.apk` or `.aab`, then open by installed package name.
- Android React Native plus Metro flow: `reinstall <app> <apk>` first, then `open <package> --remote-config <path> --relaunch`.
- macOS desktop app flow: use `open <app> --platform macos`. Only load [macos-desktop.md](macos-desktop.md) if a desktop surface or macOS-specific behavior matters.

TV example:

```bash
agent-device open MyTvApp --platform ios --target tv
agent-device open com.example.androidtv --platform android --target tv
```

## Session rules

- Use `--session <name>` when you need a named session:

```bash
agent-device --session auth open Settings --platform ios
agent-device --session auth snapshot -i
```

- Use `open <app>` before interactions.
- Use `close` when done. Add `--shutdown` when you want simulators or emulators torn down with the session.
- Use semantic session names when you need multiple concurrent runs.
- Use `--save-script=<path>` on `close` when you want to keep a replay script.
- For dev loops where state can linger, prefer `open <app> --relaunch`.
- In iOS sessions, use `open <app>` for the app itself. Use `open <url>` for deep links, and `open <app> <url>` when you need to launch the app and deep link in one step.
- On iOS, `appstate` is session-scoped and requires the matching active session on the target device.

## Session-bound automation

Use this when an orchestrator must keep plain CLI calls on one session and device.

```bash
export AGENT_DEVICE_SESSION=qa-ios
export AGENT_DEVICE_PLATFORM=ios
export AGENT_DEVICE_SESSION_LOCK=strip

agent-device open MyApp --relaunch
agent-device snapshot -i
agent-device close
```

- `AGENT_DEVICE_SESSION` plus `AGENT_DEVICE_PLATFORM` provides the default binding.
- `--session-lock reject|strip` controls whether conflicting per-call routing flags fail or are ignored.
- Conflicts include explicit retargeting flags such as `--platform`, `--target`, `--device`, `--udid`, `--serial`, `--ios-simulator-device-set`, and `--android-device-allowlist`.
- Lock policy applies to nested `batch` steps too.
- Compatibility aliases remain supported: `--session-locked`, `--session-lock-conflicts`, `AGENT_DEVICE_SESSION_LOCKED`, and `AGENT_DEVICE_SESSION_LOCK_CONFLICTS`.

Android emulator variant:

```bash
export AGENT_DEVICE_SESSION=qa-android
export AGENT_DEVICE_PLATFORM=android

agent-device reinstall MyApp /path/to/app-debug.apk --serial emulator-5554
agent-device --session-lock reject open com.example.myapp --relaunch
agent-device snapshot -i
agent-device close --shutdown
```

## Scoped discovery

Use scoped discovery when one run must not see host-global device lists.

```bash
agent-device devices --platform ios --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device devices --platform android --android-device-allowlist emulator-5554,device-1234
```

- Scope is applied before `--device`, `--udid`, and `--serial`.
- Out-of-scope selectors fail with `DEVICE_NOT_FOUND`.
- With iOS simulator-set scope enabled, iOS physical devices are not enumerated.
- If the scoped iOS simulator set is empty, the error should point at the set path and suggest creating a simulator in that set.
- Environment equivalents:
  - `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET`
  - `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST`

## Session inspection and replay

```bash
agent-device session list
agent-device replay ./session.ad --session auth
agent-device replay -u ./session.ad --session auth
```

- iOS session entries include `device_udid` and `ios_simulator_device_set`. Use them to confirm routing in concurrent runs.
- Prefer selector-based actions and assertions in saved replay scripts.
- Tenant isolation namespaces sessions as `<tenant>:<session>` during tenant-scoped runs.

## When to leave this file

- Once the correct target and session are pinned, move to [exploration.md](exploration.md).
- If opening, startup, permissions, or logs become the blocker, switch to [debugging.md](debugging.md).

## Install and open examples

```bash
agent-device reinstall MyApp /path/to/app-debug.apk --platform android --serial emulator-5554
agent-device open com.example.myapp --remote-config ./agent-device.remote.json --relaunch
```

Do not use `open <apk|aab> --relaunch` on Android.

## Security and trust notes

- Treat signing, provisioning, and daemon auth values as host secrets. Do not paste them into shared logs or commit them to source control.
- Prefer Xcode Automatic Signing over manual overrides when a physical iOS device is involved.
- Keep persistent host-specific defaults in environment variables rather than checked-in project config.
