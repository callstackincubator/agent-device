# Quick Start

Every device automation follows this pattern:

```bash
# 1. Navigate
agent-device open SampleApp --platform ios # or android

# 2. Snapshot to get element refs
agent-device snapshot -i
# Output:
# @e1 [heading] "Sample App"
# @e2 [button] "Settings"

# 3. Interact using refs
agent-device click @e2

# 4. Re-snapshot before next interactions
agent-device snapshot -i

# 5. Optional: see structural changes since last baseline
agent-device diff snapshot
```

Boot target if there is no ready device/simulator:

```bash
agent-device boot --platform ios # or android
# Android emulator launch by AVD name (GUI mode):
agent-device boot --platform android --device Pixel_9_Pro_XL
# Android headless emulator boot (AVD name):
agent-device boot --platform android --device Pixel_9_Pro_XL --headless
```

## Common commands

```bash
agent-device open SampleApp
agent-device snapshot -i                 # Get interactive elements with refs
agent-device diff snapshot               # First run initializes baseline; next runs show structural deltas
agent-device click @e2                   # Click by ref
agent-device fill @e3 "test@example.com" # Clear then type (Android verifies and retries once if needed)
agent-device get text @e1                # Get text content
agent-device screenshot page.png         # Save to specific path
agent-device install com.example.app ./build/app.apk     # Install app binary in-place
agent-device reinstall com.example.app ./build/app.apk   # Fresh-state uninstall + install
agent-device close
```

`install`/`reinstall` binary format support:

- Android: `.apk` and `.aab`
- iOS: `.app` and `.ipa`
- `.aab` requires `bundletool` in `PATH`, or `AGENT_DEVICE_BUNDLETOOL_JAR=<path-to-bundletool-all.jar>` with `java` in `PATH`.
- Optional: `AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE=<mode>` overrides bundletool `build-apks --mode` (default: `universal`).
- `.ipa` installs extract `Payload/*.app`; if multiple app bundles exist, `<app>` selects the target by bundle id or bundle name.

If `open` fails because no booted simulator/emulator/device is available, run `boot --platform ios|android` and retry.

## Fast batching

When an agent already knows a short sequence of actions, batch them:

```bash
agent-device batch \
  --platform ios \
  --steps-file /tmp/batch-steps.json \
  --json
```

See [Batching](/agent-device/pr-preview/pr-189/docs/batching.md) for payload format, failure handling, and best practices.

## Semantic discovery

Use `find` for human-readable targeting without refs:

```bash
agent-device find "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find role button click
```

## Replay (experimental)

For deterministic replay scripts and E2E guidance, see [Replay & E2E (Experimental)](/agent-device/pr-preview/pr-189/docs/replay-e2e.md).

## Scrolling

Navigate content that extends beyond the viewport:

```bash
agent-device scroll down 0.5            # Scroll down half screen
agent-device scroll up 0.3              # Scroll up 30%
```

## Settings helpers

Toggle device settings directly:

```bash
agent-device settings wifi on
agent-device settings airplane on
agent-device settings appearance toggle
agent-device settings location off
agent-device settings permission grant camera
```

Note: iOS `settings` commands are simulator-only.

## JSON output

For programmatic parsing in scripts:

```bash
agent-device snapshot --json
agent-device get text @e1 --json
```

Note: The default text output is more compact and preferred for AI agents.
