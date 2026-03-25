# Debugging

## When to open this file

Open this file when the task turns into failure triage, logs, network inspection, permission prompts, setup trouble, or unstable session behavior.

## Main commands to reach for first

- `logs clear --restart`
- `network dump`
- `logs path`
- `logs doctor`
- `alert wait`
- `alert accept` or `alert dismiss`

## Most common mistake to avoid

Do not leave logging on for normal flows or dump full log files into context. Keep debug windows short and inspect logs with `grep` or `tail`.

## Canonical loop

```bash
agent-device open MyApp --platform ios
agent-device logs clear --restart
agent-device network dump 25
agent-device logs path
agent-device close
```

## Log and network flow

Logging is off by default. Enable it only when you need a debugging window.

- `logs clear --restart` is the fastest clean repro loop.
- `network dump [limit] [summary|headers|body|all]` parses recent HTTP(s) entries from the same session app log.
- `logs doctor` checks backend and runtime readiness for the current session and device.
- `logs mark "before tap"` inserts a timestamped marker into the app log.
- Session app logs can contain runtime data, headers, or payload fragments. Review them before sharing.

Useful shell follow-up after `logs path`:

```bash
grep -n -E "Error|Exception|Fatal|crash" <path>
tail -50 <path>
```

## Alerts and permissions

Use `alert` for iOS simulator permission dialogs instead of tapping coordinates.

```bash
agent-device alert wait 5000
agent-device alert accept
```

- `alert` is only supported on iOS simulators.
- `alert accept` and `alert dismiss` retry internally for a short window, so you usually do not need manual sleeps.

## Setup problems worth recognizing early

- iOS snapshots do not require macOS Accessibility permissions.
- iOS physical-device XCTest setup does require valid signing and provisioning.
- If physical-device runner setup fails, prefer Xcode Automatic Signing first.
- Optional overrides are:
  - `AGENT_DEVICE_IOS_TEAM_ID`
  - `AGENT_DEVICE_IOS_SIGNING_IDENTITY`
  - `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`
  - `AGENT_DEVICE_IOS_BUNDLE_ID`
- If daemon startup is timing out during setup, increase `AGENT_DEVICE_DAEMON_TIMEOUT_MS`.
- If daemon startup fails with stale metadata hints, clean `~/.agent-device/daemon.json` and `~/.agent-device/daemon.lock`, then retry.
- Free Apple Developer personal-team accounts may reject generic bundle IDs. Use a unique reverse-DNS value for `AGENT_DEVICE_IOS_BUNDLE_ID` when that happens.

## Common failure patterns

- `snapshot` returns 0 nodes: the app may no longer be foregrounded or the UI is not stable yet. Re-open the app or retry when state settles.
- Logs are empty: confirm you opened an app session before `logs clear --restart`.
- Android logs look stale after relaunch: retry the repro window after the process rebinds.
- Permission prompts block the flow: wait for the alert and handle it explicitly.
- If snapshots keep returning 0 nodes on an iOS simulator, restart Simulator and re-open the app.
- If a macOS snapshot looks incomplete, compare with `snapshot --raw --platform macos` to separate collector filtering from missing AX content.

## Crash triage fast path

Always start from the session app log, then branch by platform.

```bash
agent-device logs path
grep -n -E "SIGABRT|SIGSEGV|EXC_|fatal|exception|terminated|killed|jetsam|memorystatus|FATAL EXCEPTION|Abort message" <path>
```

- iOS: if the log suggests `ReportCrash`, `SIGABRT`, or `EXC_*`, inspect `~/Library/Logs/DiagnosticReports`.
- Android: if the app log is not enough, use `adb logcat` for `FATAL EXCEPTION`, `Abort message`, or `signal` lines around process death.
- If no crash signature appears in app logs, stop collecting broad logs and switch to the platform-native crash source.

## When to leave this file

- Return to [exploration.md](exploration.md) once the app is stable again.
- Load [verification.md](verification.md) if you need evidence artifacts after reproducing the issue.
