<a href="https://www.callstack.com/open-source?utm_campaign=generic&utm_source=github&utm_medium=referral&utm_content=agent-device" align="center">
  <picture>
    <img alt="agent-device" src="website/docs/public/agent-device-banner.jpg">
  </picture>
</a>

---

# agent-device

CLI to control iOS and Android devices for AI agents influenced by Vercel’s [agent-browser](https://github.com/vercel-labs/agent-browser). 

The project is in early development and considered experimental. Pull requests are welcome!

## Features
- Platforms: iOS (simulator + limited device support) and Android (emulator + device).
- Core commands: `open`, `back`, `home`, `app-switcher`, `press`, `long-press`, `focus`, `type`, `fill`, `scroll`, `scrollintoview`, `wait`, `alert`, `screenshot`, `close`, `reinstall`.
- Inspection commands: `snapshot` (accessibility tree).
- Device tooling: `adb` (Android), `simctl`/`devicectl` (iOS via Xcode).
- Minimal dependencies; TypeScript executed directly on Node 22+ (no build step).

## Install

```bash
npm install -g agent-device
```

Or use it without installing:

```bash
npx agent-device open SampleApp
```

## Quick Start

Use refs for agent-driven exploration and normal automation flows.

```bash
agent-device open Contacts --platform ios # creates session on iOS Simulator
agent-device snapshot
agent-device click @e5
agent-device fill @e6 "John"
agent-device fill @e7 "Doe"
agent-device click @e3
agent-device close
```

## CLI Usage

```bash
agent-device <command> [args] [--json]
```

Basic flow:

```bash
agent-device open SampleApp
agent-device snapshot
agent-device click @e7
agent-device fill @e8 "hello"
agent-device close SampleApp
```

Debug flow:

```bash
agent-device trace start
agent-device snapshot -s "Sample App"
agent-device find label "Wi-Fi" click
agent-device trace stop ./trace.log
```

Coordinates:
- All coordinate-based commands (`press`, `long-press`, `focus`, `fill`) use device coordinates with origin at top-left.
- X increases to the right, Y increases downward.

## Command Index
- `boot`, `open`, `close`, `reinstall`, `home`, `back`, `app-switcher`
- `snapshot`, `find`, `get`
- `click`, `focus`, `type`, `fill`, `press`, `long-press`, `scroll`, `scrollintoview`, `is`
- `alert`, `wait`, `screenshot`
- `trace start`, `trace stop`
- `settings wifi|airplane|location on|off`
- `appstate`, `apps`, `devices`, `session list`

## Backends (iOS snapshots)

| Backend | Speed | Accuracy | Requirements |
| --- | --- | --- | --- |
| `xctest` | Fast | High | No Accessibility permission required |
| `ax` | Fast | Medium | Accessibility permission for the terminal app, not recommended |

Notes:
- Default backend is `xctest` on iOS.
- Scope snapshots with `-s "<label>"` or `-s @ref`.
- If XCTest returns 0 nodes (e.g., foreground app changed), agent-device falls back to AX when available.

Flags:
- `--version, -V` print version and exit
- `--platform ios|android`
- `--device <name>`
- `--udid <udid>` (iOS)
- `--serial <serial>` (Android)
- `--activity <component>` (Android; package/Activity or package/.Activity)
- `--session <name>`
- `--verbose` for daemon and runner logs
- `--json` for structured output
- `--backend ax|xctest` (snapshot only; defaults to `xctest` on iOS)

## Skills
Install the automation skills listed in [SKILL.md](skills/agent-device/SKILL.md).

```bash
npx skills add https://github.com/callstackincubator/agent-device --skill agent-device
```

Sessions:
- `open` starts a session. Without args boots/activates the target device/simulator without launching an app.
- All interaction commands require an open session.
- If a session is already open, `open <app>` switches the active app and updates the session app bundle.
- `close` stops the session and releases device resources. Pass an app to close it explicitly, or omit to just close the session.
- `reinstall <app> <path>` uninstalls and installs the app binary in one command (Android + iOS simulator in v1).
- `reinstall` accepts package/bundle id style app names and supports `~` in paths.
- Use `--session <name>` to manage multiple sessions.
- Session scripts are written to `~/.agent-device/sessions/<session>-<timestamp>.ad` when recording is enabled with `--save-script`.
- Deterministic replay is `.ad`-based; use `replay --update` (`-u`) to update selector drift and rewrite the replay file in place.

Find (semantic):
- `find <text> <action> [value]` finds by any text (label/value/identifier) using a scoped snapshot.
- `find text|label|value|role|id <value> <action> [value]` for specific locators.
- Actions: `click` (default), `fill`, `type`, `focus`, `get text`, `get attrs`, `wait [timeout]`, `exists`.

Assertions:
- `is` predicates: `visible`, `hidden`, `exists`, `editable`, `selected`, `text`.
- `is text` uses exact equality.

Replay update:
- `replay <path>` runs deterministic replay from `.ad` scripts.
- `replay -u <path>` attempts selector updates on failures and atomically rewrites the same file.
- Refs are the default/core mechanism for interactive agent flows.
- Update targets: `click`, `fill`, `get`, `is`, `wait`.
- Selector matching is a replay-update internal: replay parses `.ad` lines into actions, tries them, snapshots on failure, resolves a better selector, then rewrites that failing line.

Update examples:

```sh
# Before (stale selector)
click "id=\"old_continue\" || label=\"Continue\""

# After replay -u (rewritten in place)
click "id=\"auth_continue\" || label=\"Continue\""
```

```sh
# Before (ref-based action from discovery)
snapshot -i -c -s "Continue"
click @e13 "Continue"

# After replay -u (upgraded to selector-based action)
snapshot -i -c -s "Continue"
click "id=\"auth_continue\" || label=\"Continue\""
```

Android fill reliability:
- `fill` clears the current value, then enters text.
- `type` enters text into the focused field without clearing.
- `fill` now verifies the entered value on Android.
- If value does not match, agent-device clears the field and retries once with slower typing.
- This reduces IME-related character swaps on long strings (e.g. emails and IDs).

Settings helpers (simulators):
- `settings wifi on|off`
- `settings airplane on|off`
- `settings location on|off` (iOS uses per-app permission for the current session app)
Note: iOS wifi/airplane toggles status bar indicators, not actual network state. Airplane off clears status bar overrides.

App state:
- `appstate` shows the foreground app/activity (Android). On iOS it uses the current session app when available, otherwise it falls back to a snapshot-based guess (AX first, XCTest if AX can’t identify).
- `apps --metadata` returns app list with minimal metadata.

## Debug

- `agent-device trace start`
- `agent-device trace stop ./trace.log`
- The trace log includes snapshot logs and XCTest runner logs for the session.
- Built-in retries cover transient runner connection failures, AX snapshot hiccups, and Android UI dumps.
- For snapshot issues (missing elements), compare with `--raw` flag for unaltered output and scope with `-s "<label>"`.

Boot diagnostics:
- Boot failures include normalized reason codes in `error.details.reason` (JSON mode) and verbose logs.
- Reason codes: `IOS_BOOT_TIMEOUT`, `IOS_RUNNER_CONNECT_TIMEOUT`, `ANDROID_BOOT_TIMEOUT`, `ADB_TRANSPORT_UNAVAILABLE`, `CI_RESOURCE_STARVATION_SUSPECTED`, `BOOT_COMMAND_FAILED`, `UNKNOWN`.
- Android boot waits fail fast for permission/tooling issues and do not always collapse into timeout errors.
- Use `agent-device boot --platform ios|android` for explicit CI preflight readiness checks.
- Set `AGENT_DEVICE_RETRY_LOGS=1` to print structured retry telemetry (attempt, phase, delay, elapsed/remaining deadline, reason).

## App resolution
- Bundle/package identifiers are accepted directly (e.g., `com.apple.Preferences`).
- Human-readable names are resolved when possible (e.g., `Settings`).
- Built-in aliases include `Settings` for both platforms.

## iOS notes
- Input commands (`press`, `type`, `scroll`, etc.) are supported only on simulators in v1 and use the XCTest runner.
- `alert` and `scrollintoview` use the XCTest runner and are simulator-only in v1.
- Real device support (including snapshots) is on the roadmap for iOS.

## Testing

```bash
pnpm test
```

Useful local checks:

```bash
pnpm typecheck
pnpm test:unit
pnpm test:smoke
```

## Build

```bash
pnpm build
```

Environment selectors:
- `ANDROID_DEVICE=Pixel_9_Pro_XL` or `ANDROID_SERIAL=emulator-5554`
- `IOS_DEVICE="iPhone 17 Pro"` or `IOS_UDID=<udid>`
- `AGENT_DEVICE_IOS_BOOT_TIMEOUT_MS=<ms>` to adjust iOS simulator boot timeout (default: `120000`, minimum: `5000`).

Test screenshots are written to:
- `test/screenshots/android-settings.png`
- `test/screenshots/ios-settings.png`

## Contributing
See `CONTRIBUTING.md`.

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
