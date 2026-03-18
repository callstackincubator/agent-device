---
title: Commands
---

# Commands

This page summarizes the primary command groups.

For persistent defaults and project-scoped CLI settings, see [Configuration](/docs/configuration).

## Navigation

```bash
agent-device boot
agent-device boot --platform ios
agent-device boot --platform android
agent-device boot --platform android --device Pixel_9_Pro_XL --headless
agent-device open [app|url] [url]
agent-device close [app]
agent-device back
agent-device home
agent-device app-switcher
```

- `boot` ensures the selected target is ready without launching an app.
- `boot` requires either an active session or an explicit device selector.
- `--platform apple` is an alias for the iOS/tvOS backend.
- Use `--target mobile|tv` with `--platform` (required) to select phone/tablet vs TV-class devices (`AndroidTV`, `tvOS`).
- `boot` is mainly needed when starting a new session and `open` fails because no booted simulator/emulator is available.
- Android: `boot --platform android --device <avd-name>` launches that emulator in GUI mode when needed.
- Android: add `--headless` to launch without opening a GUI window.
- `open [app|url] [url]` already boots/activates the selected target when needed.
- `open <url>` deep links are supported on Android and iOS.
- `open <app> <url>` opens a deep link on iOS.
- On iOS devices, `http(s)://` URLs open in Safari when no app is active. Custom scheme URLs require an active app in the session.
- `AGENT_DEVICE_SESSION` and `AGENT_DEVICE_PLATFORM` can pre-bind a default session/platform for CLI automation runs, so normal commands (`open`, `snapshot`, `press`, `fill`, `screenshot`, `devices`, and `batch`) do not need those flags repeated on every call.
- A configured `AGENT_DEVICE_SESSION` now implies bound-session lock mode by default. The CLI forwards that policy to the daemon, which enforces the same conflict handling for CLI, typed client, and direct RPC requests.
- `--session-lock reject|strip` sets the lock policy for a single CLI invocation, including nested batch steps.
- `AGENT_DEVICE_SESSION_LOCK=reject|strip` sets the default lock policy for bound-session automation runs. The older `--session-locked`, `--session-lock-conflicts`, `AGENT_DEVICE_SESSION_LOCKED`, and `AGENT_DEVICE_SESSION_LOCK_CONFLICTS` forms remain supported as compatibility aliases.
- Direct RPC callers can pass `meta.lockPolicy` and optional `meta.lockPlatform` on `agent_device.command` requests for the same daemon-enforced behavior.
- In `batch`, steps that omit `platform` still inherit the parent batch `--platform`; lock-mode defaults do not override that parent setting.
- Tenant-scoped daemon runs can pass `--tenant`, `--session-isolation tenant`, `--run-id`, and `--lease-id` to enforce lease admission.
- Remote daemon clients can pass `--daemon-base-url http(s)://host:port[/base-path]` to skip local daemon discovery/startup and call a remote HTTP daemon directly.
- Use `--daemon-auth-token <token>` (or `AGENT_DEVICE_DAEMON_AUTH_TOKEN`) when the remote daemon expects the shared daemon token over HTTP; the client sends it in both the JSON-RPC request token and HTTP auth headers.
- `metro prepare` starts or reuses a local Metro instance for sandbox/client flows and prints runtime JSON to stdout. `--json` wraps the same payload in the standard `{ success, data }` envelope. Pass `--proxy-base-url <url>` plus `AGENT_DEVICE_PROXY_TOKEN` (preferred) or `--bearer-token <token>` when the runtime must be bridged through `agent-device-proxy`; add `--runtime-file <path>` only when a persisted artifact is required.
- `runtime set|show|clear` manages session-scoped runtime hints for remote/native daemon flows. Supported hints include `--metro-host`, `--metro-port`, `--bundle-url`, and `--launch-url`. Typed daemon clients can also pass `runtime: { ... }` on `open` to replace the stored session runtime atomically for that launch. Android applies Metro hints through React Native dev prefs before `open`, and iOS simulators apply them through app defaults before launch.
- Android React Native relaunch flows require an installed package name for `open --relaunch`; install/reinstall the APK first, then relaunch by package. `open <apk|aab> --relaunch` is rejected because runtime hints are written through the installed app sandbox.
- Remote daemon screenshots and recordings are downloaded back to the caller path, so `screenshot page.png` and `record start session.mp4` remain usable when the daemon runs on another host.

```bash
agent-device open "https://example.com" --platform ios           # open link in web browser
agent-device open MyApp "myapp://screen/to" --platform ios       # open deep link to MyApp
agent-device runtime set --session my-session --platform android --metro-host 10.0.0.10 --metro-port 8081 --launch-url "myapp://dev"
agent-device reinstall MyApp /path/to/app-debug.apk --platform android --serial emulator-5554
agent-device open com.example.myapp --platform android --serial emulator-5554 --session my-session --relaunch
```

## Device isolation scopes

```bash
agent-device devices --platform ios --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device devices --platform android --android-device-allowlist emulator-5554,device-1234
```

- `--ios-simulator-device-set <path>` constrains simulator discovery and simulator command execution via `xcrun simctl --set <path> ...`.
- `--android-device-allowlist <serials>` constrains Android discovery/selection to comma or space separated serials.
- Scope is applied before selectors (`--device`, `--udid`, `--serial`), so out-of-scope selectors fail with `DEVICE_NOT_FOUND`.
- With iOS simulator-set scope enabled, iOS physical devices are not enumerated.
- Environment equivalents:
  - iOS: `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET` (compat: `IOS_SIMULATOR_DEVICE_SET`)
  - Android: `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST` (compat: `ANDROID_DEVICE_ALLOWLIST`)
- CLI scope flags override environment values unless bound-session lock mode is active with `strip`, in which case conflicting per-call selectors are ignored.

## Device discovery

```bash
agent-device devices
agent-device devices --platform ios
agent-device devices --platform android
agent-device devices --platform ios --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device devices --platform android --android-device-allowlist emulator-5554,device-1234
```

- `devices` lists available targets after applying any platform selector or isolation scope flags.
- Use `--platform` to narrow discovery to iOS/tvOS or Android targets.
- Use `--ios-simulator-device-set` and `--android-device-allowlist` when you need tenant- or lab-scoped discovery.

## Simulator provisioning

```bash
agent-device ensure-simulator --device "iPhone 16" --platform ios
agent-device ensure-simulator --device "iPhone 16" --runtime com.apple.CoreSimulator.SimRuntime.iOS-18-4 --ios-simulator-device-set /tmp/tenant-a/simulators
agent-device ensure-simulator --device "iPhone 16" --ios-simulator-device-set /tmp/tenant-a/simulators --boot
```

- `ensure-simulator` ensures a named iOS simulator exists inside a device set, creating it via `simctl create` if missing.
- Requires `--device <name>` (the simulator name / device type, e.g. `"iPhone 16 Pro"`).
- `--runtime <id>` pins a specific CoreSimulator runtime (e.g. `com.apple.CoreSimulator.SimRuntime.iOS-18-4`). Omit to use the newest compatible runtime.
- `--boot` boots the simulator after ensuring it exists.
- Reuse of an existing matching simulator is the default; the command is idempotent.
- JSON output includes `udid`, `device`, `runtime`, `ios_simulator_device_set`, `created`, and `booted`.
- Does not require an active session — safe to call before `open`.

## TV targets

```bash
agent-device open YouTube --platform android --target tv
agent-device apps --platform android --target tv
agent-device open Settings --platform ios --target tv
agent-device screenshot apple-tv.png --platform ios --target tv
```

- AndroidTV app launch and app listing resolve TV launchable activities via `LEANBACK_LAUNCHER`.
- TV target selection supports both simulator/emulator and connected physical devices (AppleTV + AndroidTV).
- tvOS supports the same runner-driven interaction/snapshot flow as iOS (`snapshot`, `wait`, `press`, `fill`, `get`, `scroll`, `back`, `home`, `app-switcher`, `record`, and related selector flows).
- On tvOS, runner `back`/`home`/`app-switcher` map to Siri Remote actions (`menu`, `home`, double-home).
- tvOS follows iOS simulator-only command semantics for helpers like `pinch`, `settings`, and `push`.

## Snapshot and inspect

```bash
agent-device snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw]
agent-device diff snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw]
agent-device get text @e1
agent-device get attrs @e1
```

- iOS snapshots use XCTest on simulators and physical devices.
- `diff snapshot` compares the current snapshot with the previous session baseline and then updates baseline.

## Wait and alerts

```bash
agent-device wait 1500
agent-device wait text "Welcome back"
agent-device wait @e12
agent-device wait 'role="button" label="Continue"' 5000
agent-device alert
agent-device alert get
agent-device alert wait 3000
agent-device alert accept
agent-device alert dismiss
```

- `wait` accepts a millisecond duration, `text <value>`, a snapshot ref (`@eN`), or a selector.
- `wait <selector> [timeoutMs]` polls until the selector resolves or the timeout expires.
- `wait @ref [timeoutMs]` requires an existing session snapshot from a prior `snapshot` command.
- `wait @ref` resolves the ref to its label/text from that stored snapshot, then polls for that text; it does not track the original node identity.
- Because `wait @ref` is text-based after resolution, duplicate labels can match a different element than the original ref target.
- `wait` shares the selector/snapshot resolution flow used by `click`, `fill`, `get`, and `is`.
- `alert` inspects or handles system alerts on iOS simulator targets.
- `alert` without an action is equivalent to `alert get`.
- `alert wait [timeout]` waits for an alert to appear before returning it.

## Interactions

```bash
agent-device click @e1
agent-device focus @e2
agent-device fill @e2 "text"          # Clear then type
agent-device type "text"              # Type into focused field without clearing
agent-device press 300 500
agent-device press 300 500 --count 12 --interval-ms 45
agent-device press 300 500 --count 6 --hold-ms 120 --interval-ms 30 --jitter-px 2
agent-device swipe 540 1500 540 500 120
agent-device swipe 540 1500 540 500 120 --count 8 --pause-ms 30 --pattern ping-pong
agent-device longpress 300 500 800
agent-device scroll down 0.5
agent-device scrollintoview "Sign in"
agent-device scrollintoview @e42
agent-device pinch 2.0          # zoom in 2x (iOS simulator)
agent-device pinch 0.5 200 400 # zoom out at coordinates (iOS simulator)
```

`fill` clears then types. `type` does not clear.
On Android, `fill` also verifies text and performs one clear-and-retry pass on mismatch.
Some Android images cannot enter non-ASCII text over shell input; in that case use a trusted ADB keyboard IME and verify APK checksum/signature before install.
`swipe` accepts an optional `durationMs` argument (default `250ms`, range `16..10000`).
On iOS, swipe duration is clamped to a safe range (`16..60ms`) to avoid longpress side effects.
`scrollintoview` accepts plain text or a snapshot ref (`@eN`); ref mode uses best-effort geometry-based scrolling without post-scroll verification. Run `snapshot` again before follow-up `@ref` commands.
`longpress` is supported on iOS and Android.
`pinch` is iOS simulator-only.

## Find (semantic)

```bash
agent-device find "Sign In" click
agent-device find label "Email" fill "user@example.com"
agent-device find role button click
```

## Assertions

```bash
agent-device is visible 'role="button" label="Continue"'
agent-device is exists 'id="primary-cta"'
agent-device is hidden 'text="Loading..."'
agent-device is editable 'id="email"'
agent-device is selected 'label="Wi-Fi"'
agent-device is text 'id="greeting"' "Welcome back"
```

- `is` evaluates UI predicates against a selector expression and exits non-zero on failure.
- Supported predicates are `visible`, `hidden`, `exists`, `editable`, `selected`, and `text`.
- `is text <selector> <value>` compares the resolved element text against the expected value.
- `is` does not accept snapshot refs like `@e3`; use a selector expression instead.
- `is` accepts the same selector-oriented snapshot flags as `click`, `fill`, `get`, and `wait`.

## Replay

```bash
agent-device open Settings --platform ios --session e2e --save-script [path]
agent-device replay ./session.ad      # Run deterministic replay from .ad script
agent-device replay -u ./session.ad   # Update selector drift and rewrite .ad script in place
```

- `replay` runs deterministic `.ad` scripts.
- `replay -u` updates stale recorded actions and rewrites the same script.
- `--save-script` records a replay script on `close`; optional path is a file path and parent directories are created.

See [Replay & E2E (Experimental)](/docs/replay-e2e) for recording and CI workflow details.

## Batch

```bash
agent-device batch --steps-file /tmp/batch-steps.json --json
agent-device batch --steps '[{"command":"open","positionals":["settings"]}]'
```

- `batch` runs a JSON array of steps in a single daemon request.
- Each step has `command`, optional `positionals`, and optional `flags`.
- Stop-on-first-error is the supported behavior (`--on-error stop`).
- Use `--max-steps <n>` to tighten per-request safety limits.
- Batch requests inherit the same daemon lock policy and session binding metadata as the parent command.

See [Batching](/docs/batching) for payload format, response shape, and usage guidelines.

## App install (in-place)

```bash
agent-device install com.example.app ./build/app.apk --platform android
agent-device install com.example.app ./build/MyApp.app --platform ios
```

- `install <app> <path>` installs from binary path without uninstalling first.
- Supports Android devices/emulators, iOS simulators, and iOS physical devices.
- Useful for upgrade flows where you want to keep existing app data when supported by the platform.
- Remote daemons automatically upload local app artifacts for `install`; prefix the path with `remote:` to use a daemon-side path verbatim.
- Supported binary formats: Android `.apk`/`.aab`, iOS `.app`/`.ipa`.
- `.aab` requires `bundletool` in `PATH`, or `AGENT_DEVICE_BUNDLETOOL_JAR=<path-to-bundletool-all.jar>` with `java` in `PATH`.
- Optional: `AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE=<mode>` overrides bundletool `build-apks --mode` (default: `universal`).
- `.ipa` installs by extracting `Payload/*.app`; if multiple app bundles exist, `<app>` is used as a bundle id/name hint to select one.

## App reinstall (fresh state)

```bash
agent-device reinstall com.example.app ./build/app.apk --platform android
agent-device reinstall com.example.app ./build/MyApp.app --platform ios
```

- `reinstall <app> <path>` uninstalls and installs in one command.
- Supports Android devices/emulators, iOS simulators, and iOS physical devices.
- Useful for login/logout reset flows and deterministic test setup.
- Remote daemons automatically upload local app artifacts for `reinstall`; prefix the path with `remote:` to use a daemon-side path verbatim.
- Supported binary formats: Android `.apk`/`.aab`, iOS `.app`/`.ipa`.
- `.aab` accepts the same bundletool requirements and optional `AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE` override as `install`.
- `.ipa` uses `<app>` as the selection hint when multiple `Payload/*.app` bundles are present.

## App install from source URL

```bash
agent-device install-from-source https://example.com/builds/app.apk --platform android
agent-device install-from-source https://example.com/builds/MyApp.ipa --platform ios --header "authorization: Bearer TOKEN"
```

- `install-from-source <url>` installs from a URL source through the normal daemon artifact flow.
- Repeat `--header <name:value>` for authenticated or signed artifact requests.
- Supports the same device coverage as `install`: Android devices/emulators, iOS simulators, and iOS physical devices.
- `--retain-paths` keeps retained materialized artifact paths after install, and `--retention-ms <ms>` sets their TTL.
- URL downloads follow the same `installFromSource()` safety checks and host restrictions as the JS client API.

## Push notification simulation

```bash
agent-device push com.example.app ./payload.apns --platform ios
agent-device push com.example.app '{"aps":{"alert":"Welcome","badge":1}}' --platform ios
agent-device push com.example.app '{"action":"com.example.app.PUSH","extras":{"title":"Welcome","unread":3,"promo":true}}' --platform android
```

- `push <bundle|package> <payload.json|inline-json>` simulates push notification delivery.
- iOS push simulation is simulator-only (`xcrun simctl push`) and requires an APNs-style JSON object payload.
- Android uses `adb shell am broadcast` and accepts payload shape:
  `{"action":"<intent-action>","receiver":"<optional component>","extras":{"key":"value","flag":true,"count":3}}`.
- Android extras support `string`, `boolean`, and `number` values.
- `push` works with the active session device, or with explicit selectors (`--platform`, `--device`, `--udid`, `--serial`).

## App event triggers (app hook)

```bash
agent-device trigger-app-event screenshot_taken '{"source":"qa"}'
```

- `trigger-app-event <event> [payloadJson]` dispatches app-defined events via deep link.
- `trigger-app-event` requires either an active session or explicit device selectors (`--platform`, `--device`, `--udid`, `--serial`).
- On iOS physical devices, custom-scheme deep links require active app context (open app first in the session).
- Configure one of:
  - `AGENT_DEVICE_APP_EVENT_URL_TEMPLATE`
  - `AGENT_DEVICE_IOS_APP_EVENT_URL_TEMPLATE`
  - `AGENT_DEVICE_ANDROID_APP_EVENT_URL_TEMPLATE`
- Template placeholders: `{event}`, `{payload}`, `{platform}`.
- Example template: `myapp://agent-device/event?name={event}&payload={payload}`.
- `payloadJson` must be a JSON object.
- This is app-hook-based simulation and does not inject OS-global notifications.

## Settings helpers

```bash
agent-device settings wifi on
agent-device settings wifi off
agent-device settings airplane on
agent-device settings airplane off
agent-device settings location on
agent-device settings location off
agent-device settings appearance light
agent-device settings appearance dark
agent-device settings appearance toggle
agent-device settings faceid match
agent-device settings faceid nonmatch
agent-device settings faceid enroll
agent-device settings faceid unenroll
agent-device settings touchid match
agent-device settings touchid nonmatch
agent-device settings touchid enroll
agent-device settings touchid unenroll
agent-device settings fingerprint match
agent-device settings fingerprint nonmatch
agent-device settings permission grant camera
agent-device settings permission deny microphone
agent-device settings permission grant photos limited
agent-device settings permission reset notifications
```

- iOS `settings` support is simulator-only.
- `settings appearance` maps to iOS simulator appearance and Android night mode.
- Face ID and Touch ID controls are iOS simulator-only.
- Fingerprint simulation is supported on Android targets where `cmd fingerprint` or `adb emu finger` is available.
  On physical Android devices, only `cmd fingerprint` is attempted.
- Permission actions are scoped to the active session app.
- iOS permission targets: `camera`, `microphone`, `photos` (`full` or `limited`), `contacts`, `notifications`.
- Android permission targets: `camera`, `microphone`, `photos`, `contacts`, `notifications`.
- Android uses `pm grant|revoke` for runtime permissions (`reset` maps to revoke) and `appops` for notifications.
- `full|limited` mode is supported only for iOS `photos`; other targets reject mode.
- Use `match`/`nonmatch` to simulate valid/invalid Face ID, Touch ID, and Android fingerprint outcomes.

## App state and app lists

```bash
agent-device appstate
agent-device apps --platform ios
agent-device apps --platform ios --all
agent-device apps --platform android
agent-device apps --platform android --all
```

- Android `appstate` reports live foreground package/activity.
- iOS `appstate` is session-scoped and reports the app tracked by the active session on the target device.
- `apps` includes default/system apps by default (use `--user-installed` to filter).

## Clipboard

```bash
agent-device clipboard read
agent-device clipboard write "https://example.com"
agent-device clipboard write ""   # clear clipboard
```

- `clipboard read` returns clipboard text for the selected target.
- `clipboard write <text>` updates clipboard text on the selected target.
- Works with an active session device or explicit selectors (`--platform`, `--device`, `--udid`, `--serial`).
- Supported on Android emulator/device and iOS simulator.
- iOS physical devices currently return `UNSUPPORTED_OPERATION` for clipboard commands.

## Keyboard (Android)

```bash
agent-device keyboard status
agent-device keyboard get
agent-device keyboard dismiss
```

- `keyboard status` (or `keyboard get`) returns keyboard visibility and best-effort input type classification.
- `keyboard dismiss` dismisses keyboard with Android back keyevent only when the keyboard is visible, then confirms hidden state.
- Works with active sessions and explicit selectors (`--platform`, `--device`, `--udid`, `--serial`).
- Supported on Android emulator/device.

## Performance metrics

```bash
agent-device perf --json
agent-device metrics --json
```

- `perf` (alias: `metrics`) returns a session-scoped metrics JSON blob.
- Current metric: `startup` from `open-command-roundtrip` sampling.
- Sampling method: elapsed wall-clock time around each `open` command dispatch for the active session app target.
- Unit: milliseconds (`ms`).
- Platform support for current startup sampling: iOS simulator, iOS physical device, Android emulator/device.
- `fps`, `memory`, and `cpu` are surfaced as unavailable placeholders in this release.
- If no startup sample exists yet for the session, run `open <app|url>` first and retry `perf`.
- Interpretation note: this startup metric is command round-trip timing and does not represent true first frame / first interactive app instrumentation.

## Media and logs

```bash
agent-device screenshot                 # Auto filename
agent-device screenshot page.png        # Explicit screenshot path
agent-device record start               # Start screen recording to auto filename
agent-device record start session.mp4   # Start recording to explicit path
agent-device record start session.mp4 --fps 30  # Override iOS device runner FPS
agent-device record stop                # Stop active recording
```

**Session app logs (token-efficient debugging):** Logging is off by default in normal flows. Enable it on demand for debugging. Logs are written to a file so agents can grep instead of loading full output into context.

```bash
agent-device logs path                  # Print session log file path (e.g. ~/.agent-device/sessions/default/app.log)
agent-device logs start                 # Start streaming app stdout/stderr to that file (requires open first)
agent-device logs stop                  # Stop streaming
agent-device logs clear                 # Truncate app.log + remove rotated app.log.N files (requires stopped stream)
agent-device logs clear --restart       # Stop stream, clear log files, and start streaming again
agent-device logs doctor                # Show logs backend/tool checks and readiness hints
agent-device logs mark "before submit"  # Insert timeline marker into app.log
agent-device network dump 25            # Parse recent HTTP(s) requests (method/url/status) from session app log
agent-device network dump 25 all        # Include parsed headers/body when available (truncated)
```

- Supported on iOS simulator, iOS physical device, and Android.
- Preferred debug entrypoint: `logs clear --restart` for clean-window repro loops.
- `logs start` appends to `app.log` and rotates to `app.log.1` when the file exceeds 5 MB.
- `network dump [limit] [summary|headers|body|all]` parses recent HTTP(s) entries from `app.log`; `network log ...` is an alias.
- Network dump limits: scans up to 4000 recent log lines, returns up to 200 entries, and truncates payload/header fields at 2048 characters.
- Android log streaming automatically rebinds to the app PID after process restarts.
- iOS log capture relies on Unified Logging signals (for example `os_log`); plain stdout/stderr output may be limited depending on app/runtime.
- Retention knobs: set `AGENT_DEVICE_APP_LOG_MAX_BYTES` and `AGENT_DEVICE_APP_LOG_MAX_FILES` to override rotation limits.
- Optional write-time redaction patterns: set `AGENT_DEVICE_APP_LOG_REDACT_PATTERNS` to a comma-separated regex list.

**Grepping app logs:** Use `logs path` to get the file path, then run `grep` (or `grep -E`) on that path so only matching lines enter context—keeping token use low.

```bash
# Get path first (e.g. ~/.agent-device/sessions/default/app.log)
agent-device logs path

# Then grep the path; -n adds line numbers for reference
grep -n "Error\|Exception\|Fatal" ~/.agent-device/sessions/default/app.log
grep -n -E "Error|Exception|Fatal|crash" ~/.agent-device/sessions/default/app.log

# Last 50 lines only (bounded context)
tail -50 ~/.agent-device/sessions/default/app.log
```

- Use `-n` to include line numbers. Use `-E` for extended regex and `|` without escaping in the pattern.
- Prefer targeted patterns (e.g. `Error`, `Exception`, your log tags) over reading the whole file.

- iOS `record` works on simulators and physical devices.
- iOS simulator recording uses native `simctl io ... recordVideo`.
- Physical iOS device capture is runner-based and built from repeated `XCUIScreen.main.screenshot()` frames (no native video stream/audio capture).
- Physical iOS device recording requires an active app session context (`open <app>` first).
- Physical iOS device capture is best-effort: dropped frames are expected and true 60 FPS is not guaranteed even with `--fps 60`.
- Physical-device capture defaults to uncapped (max available) FPS.
- `--fps <n>` (1-120) applies to physical iOS device recording as an explicit FPS cap.

## Tracing

```bash
agent-device trace start
agent-device trace start session.trace
agent-device trace stop
agent-device trace stop session.trace
```

- `trace start [path]` begins trace-log capture for the active session.
- `trace stop [path]` stops capture and optionally writes or finalizes the trace artifact at the provided path.
- `trace` is intended for lower-level session diagnostics than `record` or `logs`.

## Runtime hints

```bash
agent-device runtime show
agent-device metro prepare --public-base-url "https://sandbox.example.test" --proxy-base-url "https://proxy.example.test" --bearer-token "$TOKEN"
agent-device runtime set --session my-session --platform android --metro-host 10.0.0.10 --metro-port 8081
agent-device runtime set --session my-session --platform ios --bundle-url "http://10.0.0.10:8081/index.bundle?platform=ios"
agent-device runtime clear
```

- `metro prepare` emits JSON runtime hints to stdout and does not mutate session runtime state by itself.
- Add `--runtime-file <path>` when callers need the same JSON payload written to disk for later steps.
- `runtime show` prints the current session-scoped runtime hints.
- `runtime set` updates supported hints: `--metro-host`, `--metro-port`, `--bundle-url`, and `--launch-url`.
- `runtime clear` removes previously configured hints for the active session.
- These hints are mainly for React Native and remote/native daemon launch flows.

## Session inspection

```bash
agent-device session list
agent-device session list --json
```

- `session list` shows active daemon sessions and their tracked device/app context.
- Use `--json` when you want to inspect or script against the raw session metadata.

## iOS device prerequisites

- Xcode + `xcrun devicectl` available.
- Paired physical device with Developer Mode enabled.
- Use Automatic Signing in Xcode, or pass optional env overrides:
  - `AGENT_DEVICE_IOS_TEAM_ID`
  - `AGENT_DEVICE_IOS_SIGNING_IDENTITY` (optional)
  - `AGENT_DEVICE_IOS_PROVISIONING_PROFILE`
  - `AGENT_DEVICE_IOS_BUNDLE_ID` (runner bundle-id base; tests use `<id>.uitests`)
- Free Apple Developer (Personal Team) accounts can fail on unavailable generic bundle IDs; set `AGENT_DEVICE_IOS_BUNDLE_ID` to a unique reverse-DNS value.
- If first-run XCTest setup/build is slow, increase daemon request timeout:
  - `AGENT_DEVICE_DAEMON_TIMEOUT_MS=120000` (default is `90000`)
- For daemon startup troubleshooting:
  - follow stale metadata hints for `<state-dir>/daemon.json` and `<state-dir>/daemon.lock` (`state-dir` defaults to `~/.agent-device`)
