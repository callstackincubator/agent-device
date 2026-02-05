# Contributing

Thanks for your interest in contributing to agent-device.

## Development

Requirements:

- Node.js 22+
- pnpm
- Android SDK tools (`adb`) for Android support
- Xcode (`simctl`/`devicectl`) for iOS support

Setup:

```bash
pnpm install
```

Build all CLIs and Xcode projects:

```bash
pnpm build:all
```

Run tests:

```bash
pnpm test
```

Optional device selectors for tests:

- `ANDROID_DEVICE=Pixel_9_Pro_XL` or `ANDROID_SERIAL=emulator-5554`
- `IOS_DEVICE="iPhone 17 Pro"` or `IOS_UDID=<udid>`

## Guidelines

- Keep dependencies minimal.
- Preserve the CLI’s agent-friendly JSON output.
- Ensure tests open and close sessions explicitly.
- Add/adjust integration tests when introducing new commands.
- Prefer built-in Node APIs over new packages.

## Reporting issues

Please include:

- OS and Node version
- Xcode/Android SDK versions (if relevant)
- Exact command and output

Thanks for helping improve agent-device.
