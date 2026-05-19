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

Apple XCTest builds now share a common helper script. `pnpm build:xcuitest:ios` and
`pnpm build:xcuitest:tvos` keep their existing cleanup behavior, while
`pnpm build:xcuitest:macos` reuses the existing DerivedData by default for faster local
iteration. Set `AGENT_DEVICE_IOS_CLEAN_DERIVED=1` when you need a clean macOS runner rebuild.

Run tests:

```bash
pnpm test
```

Targeted checks:

```bash
pnpm check:quick
pnpm check:unit
pnpm exec vitest run src/compat/maestro/__tests__/replay-flow.test.ts src/compat/__tests__/replay-input.test.ts
```

Optional device selectors for tests:

- `ANDROID_DEVICE=Pixel_9_Pro_XL` or `ANDROID_SERIAL=emulator-5554`
- `IOS_DEVICE="iPhone 17 Pro"` or `IOS_UDID=<udid>`

## Test App and Maestro Compatibility

The Expo test app lives in `examples/test-app`. Install its dependencies once:

```bash
pnpm test-app:install
```

For Maestro compatibility, we currently have 15 parser/compat unit tests and one
top-level test-app Maestro flow, `examples/test-app/maestro/checkout-form.yaml`,
which includes `examples/test-app/maestro/helpers/open-checkout-form.yaml`.

Run only the parser/compat tests:

```bash
pnpm exec vitest run src/compat/maestro/__tests__/replay-flow.test.ts src/compat/__tests__/replay-input.test.ts
```

Run the Expo test-app flow on iOS:

```bash
pnpm test-app:start
pnpm ad --session test-app-maestro open "Expo Go" exp://127.0.0.1:8081 --platform ios --device "iPhone 17 Pro"
pnpm ad --session test-app-maestro wait "Agent Device Tester" 30000 --platform ios --device "iPhone 17 Pro"
pnpm test-app:maestro:ios -- --session test-app-maestro -- --device "iPhone 17 Pro"
```

Use `pnpm test-app:maestro:android` for Android, passing the same extra
`agent-device` flags after `--`.

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
