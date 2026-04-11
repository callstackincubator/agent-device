---
title: Quick Start
---

# Quick Start

Every device automation follows this pattern:

```bash
# 1. Discover the installed app identifier when needed
agent-device apps --platform ios # or android

# 2. Navigate
agent-device open SampleApp --platform ios # or android

# 3. Snapshot to get element refs
agent-device snapshot -i
# Output:
# @e1 [heading] "Sample App"
# @e2 [button] "Settings"
# [off-screen below] 2 interactive items: "Privacy", "Battery"

# 4. Interact using refs
agent-device click @e2

# 5. Re-snapshot before next interactions; if a target only appears in an off-screen summary, scroll and re-snapshot first
agent-device snapshot -i

# 6. Optional: see structural changes since last baseline
agent-device diff snapshot
# or, from snapshot-focused help/examples:
agent-device snapshot --diff
```

React Native dev or debug builds often show warning or error overlays that can intercept taps or hide the real UI state. Check for them near app open and after major transitions. If they are not the requested behavior, dismiss them and continue, but mention them in your summary if you saw them.

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
agent-device apps --platform android    # Discover the exact package name when unsure
agent-device open SampleApp
agent-device snapshot -i                 # Get visible interactive elements with refs
agent-device diff snapshot               # Preferred exploration form for structural deltas
agent-device click @e2                   # Click by ref
agent-device fill @e3 "test@example.com" # Clear then type (Android verifies and retries once if needed)
agent-device press @e3
agent-device type " more" --delay-ms 80  # Append into the already focused field
agent-device get text @e1                # Get text content
agent-device screenshot page.png         # Save to specific path
agent-device install com.example.app ./build/app.apk     # Install app binary in-place
agent-device install-from-source https://example.com/builds/app.apk --platform android
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
If `open` fails because the app id is wrong or missing, run `apps` and retry with the discovered package or bundle id instead of guessing.

## Fast batching

When an agent already knows a short sequence of actions, batch them:

```bash
agent-device batch \
  --platform ios \
  --steps-file /tmp/batch-steps.json \
  --json
```

Example batch payload for a known chat flow:

```json
[
  { "command": "open", "positionals": ["ChatApp"], "flags": { "platform": "android" } },
  { "command": "click", "positionals": ["label=\"Travel chat\""], "flags": {} },
  { "command": "wait", "positionals": ["label=\"Message\"", "3000"], "flags": {} },
  { "command": "fill", "positionals": ["label=\"Message\"", "Filed the expense"], "flags": {} },
  { "command": "press", "positionals": ["label=\"Send\""], "flags": {} }
]
```

See [Batching](/docs/batching) for payload format, failure handling, and best practices.

## Semantic discovery

Use `find` for human-readable targeting without refs:

```bash
agent-device find "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find role button click
```

## Replay (experimental)

For deterministic replay scripts and E2E guidance, see [Replay & E2E (Experimental)](/docs/replay-e2e).

## Scrolling

Navigate content that extends beyond the viewport:

```bash
agent-device scroll down 0.5            # Scroll down half screen
agent-device scroll up 0.3              # Scroll up 30%
agent-device scroll down --pixels 320   # Scroll down by a fixed distance
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

Note: iOS `settings` commands are simulator-only. On macOS, only `settings appearance ...` and `settings permission <grant|reset> <accessibility|screen-recording|input-monitoring>` are supported.

## JSON output

For programmatic parsing in scripts:

```bash
agent-device snapshot --json
agent-device get text @e1 --json
```

Note: The default text output is more compact and preferred for AI agents.
