# agent-device

CLI to control iOS and Android devices for AI agents.

This project mirrors the spirit of `agent-browser`, but targets iOS simulators/devices and Android emulators/devices.

## Current scope (v1)
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

## Usage

```bash
agent-device <command> [args] [--json]
```

Examples:

```bash
agent-device open SampleApp
agent-device snapshot
agent-device snapshot -s @e7
agent-device click @e7
agent-device wait text "Camera"
agent-device alert wait 10000
agent-device back
agent-device type "hello"
agent-device screenshot --out ./screenshot.png
agent-device close SampleApp
```

Best practice: run `snapshot` immediately before interactions to avoid stale coordinates if the Simulator window moves or UI changes.
When interacting with UI elements from a snapshot, prefer refs (e.g. `click @e7`) over raw coordinates. Refs are stable across runs and avoid coordinate drift.

Coordinates:
- All coordinate-based commands (`press`, `long-press`, `focus`, `fill`) use device coordinates with origin at top-left.
- X increases to the right, Y increases downward.

iOS snapshots:
- Default backend is `hybrid` because it provides the best speed vs correctness trade-off: AX is fast but can miss UI details, while XCTest is slower but more complete. Hybrid uses the fast AX snapshot first, then fills empty containers (tab bars/toolbars/groups) with scoped XCTest snapshots.
- `ax` is the fast AX-only backend and requires enabling Accessibility for the terminal app in System Settings.
- `xctest` is the slower XCTest-only backend that avoids Accessibility permissions.
- You can scope snapshots to a label or identifier with `-s "<label>"` or to a previous ref with `-s @ref`.
  In practice, if AX returns a `Tab Bar` group with no children, hybrid will run a scoped XCTest snapshot for `Tab Bar` and insert those nodes under the group.

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

Sessions:
- `open` starts a session. Without args boots/activates the target device/simulator without launching an app.
- All interaction commands require an open session.
- `close` stops the session and releases device resources. Pass an app to close it explicitly, or omit to just close the session.
- Use `--session <name>` to manage multiple sessions.
- Session logs are written to `~/.agent-device/sessions/<session>-<timestamp>.ad`.

Snapshot defaults to the hybrid backend on iOS simulators. Use `--backend ax` for AX-only or `--backend xctest` for XCTest-only.

## App resolution
- Bundle/package identifiers are accepted directly (e.g., `com.apple.Preferences`).
- Human-readable names are resolved when possible (e.g., `Settings`).
- Built-in aliases include `Settings` for both platforms.

## iOS notes
- Input commands (`press`, `type`, `scroll`, etc.) are supported only on simulators in v1 and use the XCTest runner.
- `alert` and `scrollintoview` use the XCTest runner and are simulator-only in v1.

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
