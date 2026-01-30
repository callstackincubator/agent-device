# agent-device

Unified control CLI for physical and virtual devices (iOS + Android) for AI agents.

This project mirrors the spirit of `agent-browser`, but targets iOS simulators/devices and Android emulators/devices.

## Current scope (v1)
- Platforms: iOS (simulator + limited device support) and Android (emulator + device).
- Core commands: `open`, `press`, `long-press`, `focus`, `type`, `fill`, `scroll`, `scrollintoview`, `screenshot`, `close`.
- Device tooling: `adb` (Android), `simctl`/`devicectl` (iOS via Xcode).
- Minimal dependencies; TypeScript executed directly on Node 22+ (no build step).

## Install

```bash
npm install -g agent-device
```

Or use it without installing:

```bash
npx agent-device open Settings
```

## Usage

```bash
agent-device <command> [args] [--json]
```

Examples:

```bash
agent-device open Settings
agent-device press 120 320
agent-device type "hello"
agent-device screenshot --out ./screenshot.png
agent-device close Settings
```

Flags:
- `--platform ios|android`
- `--device <name>`
- `--udid <udid>` (iOS)
- `--serial <serial>` (Android)
- `--out <path>` (screenshot)
- `--session <name>`
- `--verbose` for daemon and runner logs
- `--json` for structured output

Sessions:
- `open` starts a session.
- All interaction commands require an open session.
- `close` stops the session and releases device resources. Pass an app to close it explicitly, or omit to just close the session.
- Use `--session <name>` to manage multiple sessions.

iOS simulator input:
- If `simctl` input is unavailable for your Xcode version, the CLI will use the XCTest runner to perform taps and scrolls.

## App resolution
- Bundle/package identifiers are accepted directly (e.g., `com.apple.Preferences`).
- Human-readable names are resolved when possible (e.g., `Settings`).
- Built-in aliases include `Settings` for both platforms.

## iOS notes
- Input commands (`press`, `type`, `scroll`, etc.) are supported only on simulators in v1.
- Support depends on your Xcode version; the CLI reports `UNSUPPORTED_OPERATION` if `simctl io` lacks input operations.

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

## Made with ❤️ at Callstack

agent-device is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
