# agent-device

CLI to control iOS and Android devices for AI agents influenced by Vercel’s [agent-browser](https://github.com/vercel/agent-browser).

The project is in early development and considered experimental. Pull requests are welcome!

## Features
- Platforms: iOS (simulator + limited device support) and Android (emulator + device).
- Core commands: `open`, `back`, `home`, `app-switcher`, `press`, `long-press`, `focus`, `type`, `fill`, `scroll`, `scrollintoview`, `wait`, `alert`, `screenshot`, `close`.
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

```bash
agent-device open Contacts --platform ios
agent-device snapshot -i -c --platform ios
agent-device click @e5 --platform ios
agent-device fill @e6 "John" --platform ios
agent-device fill @e7 "Doe" --platform ios
agent-device click @e3 --platform ios
agent-device close
```

## CLI Usage

```bash
agent-device <command> [args] [--json]
```

Basic flow:

```bash
agent-device open SampleApp
agent-device snapshot -i -c
agent-device click @e7
agent-device fill @e8 "hello"
agent-device close SampleApp
```

Debug flow:

```bash
agent-device trace start
agent-device snapshot --backend xctest -s "Sample App"
agent-device find label "Wi-Fi" click
agent-device trace stop ./trace.log
```

Coordinates:
- All coordinate-based commands (`press`, `long-press`, `focus`, `fill`) use device coordinates with origin at top-left.
- X increases to the right, Y increases downward.

## Command Index
- `open`, `close`, `home`, `back`, `app-switcher`
- `snapshot`, `find`, `get`
- `click`, `focus`, `type`, `fill`, `press`, `long-press`, `scroll`, `scrollintoview`
- `alert`, `wait`, `screenshot`
- `trace start`, `trace stop`
- `settings wifi|airplane|location on|off`
- `appstate`, `apps`, `devices`, `session list`

## Backends (iOS snapshots)

| Backend | Speed | Accuracy | Requirements |
| --- | --- | --- | --- |
| `ax` | Fast | Medium | Accessibility permission for the terminal app |
| `xctest` | Slow | High | No Accessibility permission required |
| `hybrid` | Fast | High | Uses AX first, fills empty containers with scoped XCTest |

Notes:
- Default backend is `hybrid` on iOS.
- Scope snapshots with `-s "<label>"` or `-s @ref`.

Flags:
- `--platform ios|android`
- `--device <name>`
- `--udid <udid>` (iOS)
- `--serial <serial>` (Android)
- `--out <path>` (screenshot)
- `--session <name>`
- `--verbose` for daemon and runner logs
- `--json` for structured output
- `--backend ax|xctest|hybrid` (snapshot only; defaults to `hybrid` on iOS)

## Skills
Install the automation skills listed in [SKILL.md](skills/agent-device/SKILL.md).

Sessions:
- `open` starts a session. Without args boots/activates the target device/simulator without launching an app.
- All interaction commands require an open session.
- `close` stops the session and releases device resources. Pass an app to close it explicitly, or omit to just close the session.
- Use `--session <name>` to manage multiple sessions.
- Session logs are written to `~/.agent-device/sessions/<session>-<timestamp>.ad`.

Find (semantic):
- `find <text> <action> [value]` finds by any text (label/value/identifier) using a scoped snapshot.
- `find text|label|value|role|id <value> <action> [value]` for specific locators.
- Actions: `click` (default), `fill`, `type`, `focus`, `get text`, `get attrs`, `wait [timeout]`, `exists`.

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
- The trace log includes AX snapshot stderr and XCTest runner logs for the session.
- Built-in retries cover transient runner connection failures, AX snapshot hiccups, and Android UI dumps.
- For snapshot issues, compare `--backend ax` vs `--backend xctest` and scope with `-s "<label>"`.

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

## Build

```bash
pnpm build
```

Environment selectors:
- `ANDROID_DEVICE=Pixel_9_Pro_XL` or `ANDROID_SERIAL=emulator-5554`
- `IOS_DEVICE="iPhone 17 Pro"` or `IOS_UDID=<udid>`

Test screenshots are written to:
- `test/screenshots/android-settings.png`
- `test/screenshots/ios-settings.png`

## Contributing
See `CONTRIBUTING.md`.

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
