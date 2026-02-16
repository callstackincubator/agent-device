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
- Platforms: iOS (simulator + physical device core automation) and Android (emulator + device).
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
- All coordinate-based commands (`press`, `long-press`, `swipe`, `focus`, `fill`) use device coordinates with origin at top-left.
- X increases to the right, Y increases downward.

Gesture series examples:

```bash
agent-device press 300 500 --count 12 --interval-ms 45
agent-device press 300 500 --count 6 --hold-ms 120 --interval-ms 30 --jitter-px 2
agent-device swipe 540 1500 540 500 120 --count 8 --pause-ms 30 --pattern ping-pong
```

## Command Index
- `boot`, `open`, `close`, `reinstall`, `home`, `back`, `app-switcher`
- `snapshot`, `find`, `get`
- `click`, `focus`, `type`, `fill`, `press`, `long-press`, `swipe`, `scroll`, `scrollintoview`, `pinch`, `is`
- `alert`, `wait`, `screenshot`
- `trace start`, `trace stop`
- `settings wifi|airplane|location on|off`
- `appstate`, `apps`, `devices`, `session list`

## iOS Snapshots

Notes:
- iOS snapshots use XCTest on simulators and physical devices.
- Scope snapshots with `-s "<label>"` or `-s @ref`.
- If XCTest returns 0 nodes (e.g., foreground app changed), agent-device fails explicitly.

Flags:
- `--version, -V` print version and exit
- `--platform ios|android`
- `--device <name>`
- `--udid <udid>` (iOS)
- `--serial <serial>` (Android)
- `--activity <component>` (Android app launch only; package/Activity or package/.Activity; not for URL opens)
- `--session <name>`
- `--count <n>` repeat count for `press`/`swipe`
- `--interval-ms <ms>` delay between `press` iterations
- `--hold-ms <ms>` hold duration per `press` iteration
- `--jitter-px <n>` deterministic coordinate jitter for `press`
- `--pause-ms <ms>` delay between `swipe` iterations
- `--pattern one-way|ping-pong` repeat pattern for `swipe`
- `--verbose` for daemon and runner logs
- `--json` for structured output

Pinch:
- `pinch` is supported on iOS simulators.
- On Android, `pinch` currently returns `UNSUPPORTED_OPERATION` in the adb backend.

Swipe timing:
- `swipe` accepts optional `durationMs` (default `250`, range `16..10000`).
- Android uses requested swipe duration directly.
- iOS uses a safe normalized duration to avoid long-press side effects.

## Skills
Install the automation skills listed in [SKILL.md](skills/agent-device/SKILL.md).

```bash
npx skills add https://github.com/callstackincubator/agent-device --skill agent-device
```

Sessions:
- `open` starts a session. Without args boots/activates the target device/simulator without launching an app.
- All interaction commands require an open session.
- If a session is already open, `open <app|url>` switches the active app or opens a deep link URL.
- `close` stops the session and releases device resources. Pass an app to close it explicitly, or omit to just close the session.
- Use `--session <name>` to manage multiple sessions.
- Session scripts are written to `~/.agent-device/sessions/<session>-<timestamp>.ad` when recording is enabled with `--save-script`.
- Deterministic replay is `.ad`-based; use `replay --update` (`-u`) to update selector drift and rewrite the replay file in place.

Navigation helpers:
- `boot --platform ios|android` ensures the target is ready without launching an app.
- Use `boot` mainly when starting a new session and `open` fails because no booted simulator/emulator is available.
- `open [app|url]` already boots/activates the selected target when needed.
- `reinstall <app> <path>` uninstalls and installs the app binary in one command (Android + iOS simulator).
- `reinstall` accepts package/bundle id style app names and supports `~` in paths.

Deep links:
- `open <url>` supports deep links with `scheme://...`.
- Android opens deep links via `VIEW` intent.
- iOS deep link open is simulator-only.
- `--activity` cannot be combined with URL opens.

```bash
agent-device open "myapp://home" --platform android
agent-device open "https://example.com" --platform ios
```

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

Settings helpers:
- `settings wifi on|off`
- `settings airplane on|off`
- `settings location on|off` (iOS uses per-app permission for the current session app)
Note: iOS supports these only on simulators. iOS wifi/airplane toggles status bar indicators, not actual network state. Airplane off clears status bar overrides.

App state:
- `appstate` shows the foreground app/activity (Android). On iOS it uses the current session app when available, otherwise it resolves via XCTest snapshot.
- `apps --metadata` returns app list with minimal metadata.

## Debug

- `agent-device trace start`
- `agent-device trace stop ./trace.log`
- The trace log includes snapshot logs and XCTest runner logs for the session.
- Built-in retries cover transient runner connection failures and Android UI dumps.
- For snapshot issues (missing elements), compare with `--raw` flag for unaltered output and scope with `-s "<label>"`.

Boot diagnostics:
- Boot failures include normalized reason codes in `error.details.reason` (JSON mode) and verbose logs.
- Reason codes: `IOS_BOOT_TIMEOUT`, `IOS_RUNNER_CONNECT_TIMEOUT`, `ANDROID_BOOT_TIMEOUT`, `ADB_TRANSPORT_UNAVAILABLE`, `CI_RESOURCE_STARVATION_SUSPECTED`, `BOOT_COMMAND_FAILED`, `UNKNOWN`.
- Android boot waits fail fast for permission/tooling issues and do not always collapse into timeout errors.
- Use `agent-device boot --platform ios|android` when starting a new session only if `open` cannot find/connect to an available target.
- Set `AGENT_DEVICE_RETRY_LOGS=1` to print structured retry telemetry (attempt, phase, delay, elapsed/remaining deadline, reason).

## App resolution
- Bundle/package identifiers are accepted directly (e.g., `com.apple.Preferences`).
- Human-readable names are resolved when possible (e.g., `Settings`).
- Built-in aliases include `Settings` for both platforms.

## iOS notes
- Core runner commands (`snapshot`, `wait`, `click`, `fill`, `get`, `is`, `find`, `press`, `long-press`, `focus`, `type`, `scroll`, `scrollintoview`, `back`, `home`, `app-switcher`) support iOS simulators and iOS devices.
- Simulator-only commands: `alert`, `pinch`, `record`, `reinstall`, `apps`, `settings`.
- iOS deep link open (`open <url>`) is simulator-only.
- iOS device runs require valid signing/provisioning (Automatic Signing recommended). Optional overrides: `AGENT_DEVICE_IOS_TEAM_ID`, `AGENT_DEVICE_IOS_SIGNING_IDENTITY`, `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`.

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
- `AGENT_DEVICE_DAEMON_TIMEOUT_MS=<ms>` to increase daemon request timeout for slow first-run iOS device setup (for example `180000`).
- `AGENT_DEVICE_IOS_TEAM_ID=<team-id>` optional Team ID override for iOS device runner signing.
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY=<identity>` optional signing identity override.
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE=<profile>` optional provisioning profile specifier for iOS device runner signing.
- `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH=<path>` optional override for iOS runner derived data root. By default, agent-device separates caches by target kind (`.../derived/simulator` and `.../derived/device`). If you set this override, use separate paths per kind to avoid simulator/device artifact collisions.
- `AGENT_DEVICE_IOS_CLEAN_DERIVED=1` rebuild iOS runner artifacts from scratch. When `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH` is set, cleanup is blocked by default; set `AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN=1` only for trusted custom paths.

Test screenshots are written to:
- `test/screenshots/android-settings.png`
- `test/screenshots/ios-settings.png`

## Contributing
See `CONTRIBUTING.md`.

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
