# Commands

This page summarizes the primary command groups.

For persistent defaults and project-scoped CLI settings, see [Configuration](/agent-device/pr-preview/pr-357/docs/configuration.md).

## Navigation

```bash
agent-device boot
agent-device boot --platform ios
agent-device boot --platform android
agent-device boot --platform android --device Pixel_9_Pro_XL --headless
agent-device open [app|url] [url]
agent-device open --platform macos --surface frontmost-app
agent-device open --platform macos --surface desktop
agent-device close [app]
agent-device back
agent-device back --in-app
agent-device back --system
agent-device home
agent-device rotate portrait
agent-device rotate landscape-left
agent-device app-switcher
```

- `boot` ensures the selected target is ready without launching an app.
- `boot` requires either an active session or an explicit device selector.
- `--platform apple` is an alias for the Apple automation backend (`ios`, `tvOS`, `macOS` selection).
- Use `--target mobile|tv|desktop` with `--platform` (required) to select phone/tablet vs TV-class vs desktop-class targets.
- `boot` is mainly needed when starting a new session and `open` fails because no booted simulator/emulator is available.
- Android: `boot --platform android --device <avd-name>` launches that emulator in GUI mode when needed.
- Android: add `--headless` to launch without opening a GUI window.
- `open [app|url] [url]` already boots/activates the selected target when needed.
- `open <url>` deep links are supported on Android and iOS.
- `open <app> <url>` opens a deep link on iOS.
- `open --platform macos --surface app|frontmost-app|desktop|menubar` selects the macOS session surface explicitly. `app` is the default when an app argument is provided.
- `back` now defaults to app-owned back navigation. On Apple targets that means visible in-app back UI only. On Android this currently maps to the same back keyevent because Android routes in-app back through that platform event.
- `back --in-app` is an explicit alias for the default app-owned behavior.
- `back --system` asks for system back input explicitly. On Android this is the normal back keyevent. On iOS and tvOS it uses the platform back gesture or Siri Remote menu action. On macOS, where there is no generic system back input, `back --system` reports unavailable instead of falling back to app-owned navigation.
- `rotate <orientation>` forces a mobile device into `portrait`, `portrait-upside-down`, `landscape-left`, or `landscape-right`.
- `rotate` is supported on iOS and Android mobile targets. macOS and tvOS do not expose it.
- On iOS devices, `http(s)://` URLs open in Safari when no app is active. Custom scheme URLs require an active app in the session.
- `AGENT_DEVICE_SESSION` and `AGENT_DEVICE_PLATFORM` can pre-bind a default session/platform for CLI automation runs, so normal commands (`open`, `snapshot`, `press`, `fill`, `screenshot`, `devices`, and `batch`) do not need those flags repeated on every call.
- A configured `AGENT_DEVICE_SESSION` implies bound-session lock mode by default. The CLI forwards that policy to the daemon, which enforces the same conflict handling for CLI, typed client, and direct RPC requests.
- `--session-lock reject|strip` sets the lock policy for a single CLI invocation, including nested batch steps.
- `AGENT_DEVICE_SESSION_LOCK=reject|strip` sets the default lock policy for bound-session automation runs. The older `--session-locked`, `--session-lock-conflicts`, `AGENT_DEVICE_SESSION_LOCKED`, and `AGENT_DEVICE_SESSION_LOCK_CONFLICTS` forms remain supported as compatibility aliases.
- Direct RPC callers can pass `meta.lockPolicy` and optional `meta.lockPlatform` on `agent_device.command` requests for the same daemon-enforced behavior.
- In `batch`, steps that omit `platform` still inherit the parent batch `--platform`; lock-mode defaults do not override that parent setting.
- Tenant-scoped daemon runs can pass `--tenant`, `--session-isolation tenant`, `--run-id`, and `--lease-id` to enforce lease admission.
- Remote daemon clients can pass `--daemon-base-url http(s)://host:port[/base-path]` to skip local daemon discovery/startup and call a remote HTTP daemon directly.
- Use `--daemon-auth-token <token>` (or `AGENT_DEVICE_DAEMON_AUTH_TOKEN`) when the remote daemon expects the shared daemon token over HTTP; the client sends it in both the JSON-RPC request token and HTTP auth headers.
- `open <app> --remote-config <path> --relaunch` is the canonical remote Metro-backed launch flow for sandbox agents. The remote profile supplies the remote host + Metro settings, `open` prepares Metro locally when needed, derives platform runtime hints, and forwards them inline to the remote daemon before launch.
- `metro prepare --remote-config <path>` remains available for inspection and debugging. It prints JSON runtime hints to stdout, `--json` wraps them in the standard `{ success, data }` envelope, and `--runtime-file <path>` persists the same payload when callers need an artifact.
- Android React Native relaunch flows require an installed package name for `open --relaunch`; install/reinstall the APK first, then relaunch by package. `open <apk|aab> --relaunch` is rejected because runtime hints are written through the installed app sandbox.
- Remote daemon screenshots and recordings are downloaded back to the caller path, so `screenshot page.png` and `record start session.mp4` remain usable when the daemon runs on another host.

```bash
agent-device open "https://example.com" --platform ios           # open link in web browser
agent-device open MyApp "myapp://screen/to" --platform ios       # open deep link to MyApp
agent-device back --platform ios                                 # tap visible app back UI only
agent-device back --system --platform ios                        # use edge-swipe or remote back action
agent-device open com.example.myapp --remote-config ./agent-device.remote.json --relaunch
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
- Use `--platform` to narrow discovery to Apple-family (`ios`, `tvOS`, `macOS`) or Android targets.
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

## Desktop targets

```bash
agent-device devices --platform macos
agent-device open TextEdit --platform macos
agent-device open --platform macos --surface desktop
agent-device snapshot -i --platform apple --target desktop
```

- `--platform macos` selects the host Mac as a `desktop` target.
- `--platform apple --target desktop` selects the same macOS backend through the Apple-family alias.
- Use `app` sessions for normal app control: `open`, `snapshot`, `click`, `fill`, `press`, `scroll`, `back`, `screenshot`, `record`.
- Use `frontmost-app`, `desktop`, and `menubar` when you need to inspect desktop-global UI before choosing one app.
- `open --platform macos --surface frontmost-app` inspects the currently focused app without naming it first.
- `open --platform macos --surface desktop` inspects visible windows across the desktop.
- `open --platform macos --surface menubar` inspects the active app menu bar and system menu extras.
- `open <app> --platform macos --surface menubar` targets one menu bar app's extras bar, which is useful for status-item apps.
- Status-item apps often expose little or no useful UI through the default macOS `app` surface. Prefer `--surface menubar` for discovery when the app lives in the top menu bar.
- Use `frontmost-app`, `desktop`, and `menubar` mainly for `snapshot`, `get`, `is`, and `wait`.
- If you inspect with `desktop` or `menubar` and then need to click or fill inside one app, open that app in a normal `app` session.
- macOS also supports `clipboard read|write`, `trigger-app-event`, `logs`, `network dump`, `alert`, `pinch` in app sessions, `settings appearance`, and `settings permission <grant|reset> <accessibility|screen-recording|input-monitoring>`.
- In macOS app sessions, `screenshot` captures the target app window bounds rather than the full desktop.
- Prefer selector or `@ref`-driven interactions on macOS. Window position can shift between runs, so raw x/y point commands are less stable than snapshot-derived targets.
- Use `click --button secondary` for context menus on macOS, then run `snapshot -i` again.
- Mobile-only helpers remain unsupported on macOS: `boot`, `home`, `rotate`, `app-switcher`, `install`, `reinstall`, `install-from-source`, and `push`.

Recommended loops:

```bash
# One app, full interaction
agent-device open TextEdit --platform macos
agent-device snapshot -i
agent-device fill @e3 "hello"
agent-device screenshot textedit.png
agent-device close

# Desktop-global inspection first
agent-device open --platform macos --surface desktop
agent-device snapshot -i
agent-device is visible 'role="window" label="Notes"'
agent-device screenshot desktop.png --fullscreen
agent-device close

# Menubar / menu-extra inspection
agent-device open --platform macos --surface menubar
agent-device snapshot -i
agent-device wait 'label~="Wi-Fi|Control Center|Battery"'
agent-device close

# Targeted menu bar app inspection
agent-device open MenuBarApp --platform macos --surface menubar
agent-device snapshot -i
agent-device close
```

## Snapshot and inspect

```bash
agent-device snapshot [--diff] [-i] [-c] [-d <depth>] [-s <scope>] [--raw]
agent-device diff snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw]
agent-device get text @e1
agent-device get attrs @e1
```

- iOS snapshots use XCTest on simulators and physical devices.
- `diff snapshot` compares the current snapshot with the previous session baseline and then updates baseline.
- `snapshot --diff` is an alias for `diff snapshot`.

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
- `alert` inspects or handles system alerts on iOS simulator and macOS desktop targets.
- `alert` without an action is equivalent to `alert get`.
- `alert wait [timeout]` waits for an alert to appear before returning it.
- If an iOS permission sheet is visible in `snapshot` or `screenshot` but `alert accept` reports no alert, fall back to a scoped `snapshot -i -s "<visible label>"` plus `press @ref`; not every simulator permission surface is exposed as a native XCTest alert.

## Interactions

```bash
agent-device click @e1
agent-device click @e1 --button secondary   # macOS secondary click / context menu
agent-device focus @e2
agent-device fill @e2 "text"          # Clear then type
agent-device fill @e2 "search" --delay-ms 80
agent-device type "text"              # Type into focused field without clearing
agent-device type "query" --delay-ms 80
agent-device press 300 500
agent-device press 300 500 --count 12 --interval-ms 45
agent-device press 300 500 --count 6 --hold-ms 120 --interval-ms 30 --jitter-px 2
agent-device swipe 540 1500 540 500 120
agent-device swipe 540 1500 540 500 120 --count 8 --pause-ms 30 --pattern ping-pong
agent-device longpress 300 500 800
agent-device scroll down 0.5
agent-device scroll down --pixels 320
agent-device scrollintoview "Sign in"
agent-device scrollintoview "Sign in" --max-scrolls 6
agent-device scrollintoview @e42
agent-device pinch 2.0          # zoom in 2x (Apple simulator or macOS app session)
agent-device pinch 0.5 200 400 # zoom out at coordinates (Apple simulator or macOS app session)
```

`fill` clears then types. `type` does not clear.
`type` accepts text only. Do not pass `@ref` to `type`; use `fill @ref "text"` to target a field directly, or `press @ref` then `type "text"` to append in the focused field.
Use `--delay-ms` on `type` or `fill` for debounced search fields and search-as-you-type inputs that miss characters when text is injected too quickly.
Delayed typing prefers paced character entry over clipboard-style fallbacks so the target field still receives incremental updates.
On Android, `fill` also verifies text and performs one clear-and-retry pass on mismatch.
Some Android images cannot enter non-ASCII text over shell input; in that case use a trusted ADB keyboard IME and verify APK checksum/signature before install.
`click --button secondary` is the desktop context-menu flow on macOS.
`click --button middle` is reserved for future runner support and currently returns an explicit unsupported-operation error on macOS.
`swipe` accepts an optional `durationMs` argument (default `250ms`, range `16..10000`).
On iOS, swipe duration is clamped to a safe range (`16..60ms`) to avoid longpress side effects.
`scroll` accepts either a relative amount (`0.5` means roughly half of the viewport on that axis) or `--pixels <n>` for a fixed-distance gesture. Large distances are clamped to the usable drag band so the gesture stays reliable across Android, iOS, and macOS.
`scrollintoview` accepts plain text or a snapshot ref (`@eN`).
Use `--max-scrolls <n>` to cap the number of scroll gestures explicitly.
When omitted, Apple text/ref paths default to `48` scrolls; Android text mode defaults to `8` because each attempt re-dumps the full UI hierarchy.
Ref mode re-snapshots after each swipe, returns a refreshed `currentRef` when it can track the target, and stops early when the target enters the safe viewport band or scrolling stops making progress.
Default snapshot text output is visible-first, so off-screen interactive content is summarized instead of shown as tappable refs.
`press @ref` and `fill @ref` fail fast when the target is off-screen; use `scrollintoview @ref` first, then retry with the returned `currentRef` or a fresh snapshot.
`longpress` is supported on iOS and Android.
`pinch` is supported on Apple simulators and macOS app sessions.

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
- `is visible` checks whether the resolved element is present in the current visible snapshot viewport. A node without its own rect still passes when a visible ancestor within the viewport provides the on-screen geometry.
- `is exists` only checks whether the selector matches in the current snapshot.
- `wait text` is a text-presence wait, not a hittability assertion.
- `is text <selector> <value>` compares the resolved element text against the expected value.
- `is` does not accept snapshot refs like `@e3`; use a selector expression instead.
- `is` accepts the same selector-oriented snapshot flags as `click`, `fill`, `get`, and `wait`.

## Replay

```bash
agent-device open Settings --platform ios --session e2e --save-script [path]
agent-device replay ./session.ad      # Run deterministic replay from .ad script
agent-device test ./suite             # Run every .ad file in a folder or glob serially
agent-device test ./suite --timeout 60000 --retries 1
agent-device replay -u ./session.ad   # Update selector drift and rewrite .ad script in place
```

- `replay` runs deterministic `.ad` scripts.
- `test` runs one or more `.ad` scripts as a serial suite from files, directories, or glob inputs.
- `test --platform <platform>` filters suite files by `context platform=...` metadata instead of overriding the script target.
- `test --timeout <ms>` and `test --retries <n>` apply per script attempt; `context timeout=...` and `context retries=...` can be declared inside the `.ad` header. Retries are capped at `3`, duplicate metadata keys are rejected, and timeouts are cooperative.
- `test --artifacts-dir <path>` overrides the default suite artifact root at `.agent-device/test-artifacts`.
- `test` prints failures and flaky passed-on-retry tests by default, and prints a short `Running replay suite...` line before dispatch; add `--verbose` to print pass and skip lines too.
- `replay -u` updates stale recorded actions and rewrites the same script.
- `--save-script` records a replay script on `close`; optional path is a file path and parent directories are created.

See [Replay & E2E (Experimental)](/agent-device/pr-preview/pr-357/docs/replay-e2e.md) for recording and CI workflow details.

## Batch

```bash
agent-device batch --steps-file /tmp/batch-steps.json --json
agent-device batch --steps '[{"command":"open","positionals":["settings"]}]'
```

- `batch` runs a JSON array of steps in a single daemon request.
- Each step has `command`, optional `positionals`, optional `flags`, and optional `runtime`.
- Unknown top-level step fields are rejected.
- Stop-on-first-error is the supported behavior (`--on-error stop`).
- Use `--max-steps <n>` to tighten per-request safety limits.
- Batch requests inherit the same daemon lock policy and session binding metadata as the parent command.
- In non-JSON mode, successful batches print a short per-step summary.

See [Batching](/agent-device/pr-preview/pr-357/docs/batching.md) for payload format, response shape, and usage guidelines.

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
- On macOS, use `AGENT_DEVICE_MACOS_APP_EVENT_URL_TEMPLATE` to override the desktop deep-link template.
- On iOS physical devices, custom-scheme deep links require active app context (open app first in the session).
- Configure one of:
  - `AGENT_DEVICE_APP_EVENT_URL_TEMPLATE`
  - `AGENT_DEVICE_IOS_APP_EVENT_URL_TEMPLATE`
  - `AGENT_DEVICE_MACOS_APP_EVENT_URL_TEMPLATE`
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
agent-device settings permission grant accessibility --platform macos
agent-device settings permission reset screen-recording --platform macos
```

- iOS `settings` support is simulator-only except for `settings appearance` and the macOS permission subset on macOS.
- macOS supports only `settings appearance <light|dark|toggle>` and `settings permission <grant|reset> <accessibility|screen-recording|input-monitoring>`.
- `settings wifi|airplane|location` remain intentionally unsupported on macOS.
- `settings appearance` maps to macOS appearance, iOS simulator appearance, and Android night mode.
- Face ID and Touch ID controls are iOS simulator-only.
- Fingerprint simulation is supported on Android targets where `cmd fingerprint` or `adb emu finger` is available.
  On physical Android devices, only `cmd fingerprint` is attempted.
- Permission actions are scoped to the active session app.
- iOS permission targets: `camera`, `microphone`, `photos` (`full` or `limited`), `contacts`, `notifications`.
- Android permission targets: `camera`, `microphone`, `photos`, `contacts`, `notifications`.
- macOS permission targets: `accessibility`, `screen-recording`, `input-monitoring`.
- On macOS, `settings permission grant ...` checks/request access and opens System Settings guidance when needed; it does not silently grant TCC permissions.
- On macOS, `settings permission deny ...` is intentionally unsupported.
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
- Supported on macOS, Android emulator/device, and iOS simulator.
- iOS physical devices currently return `UNSUPPORTED_OPERATION` for clipboard commands.

## Keyboard

```bash
agent-device keyboard status
agent-device keyboard get
agent-device keyboard dismiss
```

- `keyboard status` (or `keyboard get`) returns keyboard visibility and best-effort input type classification on Android.
- `keyboard dismiss` attempts a non-navigation keyboard dismissal on Android and a native dismiss gesture/control on iOS, then confirms the keyboard is hidden.
- If the keyboard remains visible after the platform-native dismiss path, the command returns an explicit `UNSUPPORTED_OPERATION` error instead of falling back to back navigation.
- Works with active sessions and explicit selectors (`--platform`, `--device`, `--udid`, `--serial`).
- `keyboard status|get` is supported on Android emulator/device.
- `keyboard dismiss` is supported on Android emulator/device and iOS simulator/device.

## Performance metrics

```bash
agent-device perf --json
agent-device metrics --json
```

- `perf` (alias: `metrics`) returns a session-scoped metrics JSON blob.
- `startup` is sampled from `open-command-roundtrip`: elapsed wall-clock time around each `open` command dispatch for the active session app target.
- Android app sessions with an active package also sample:
  - `memory` from `adb shell dumpsys meminfo <package>` with values reported in kilobytes (`kB`)
  - `cpu` from `adb shell dumpsys cpuinfo`, aggregated across matching package processes and reported as a recent percentage snapshot
- Apple app sessions with an active bundle ID also sample:
  - `memory` from process RSS snapshots reported in kilobytes (`kB`)
  - `cpu` from process CPU usage snapshots reported as a recent percentage
- Platform support:
  - `startup`: iOS simulator, iOS physical device, Android emulator/device
  - `memory` and `cpu`: Android emulator/device, macOS app sessions, and iOS simulators with an active app session (`open <app>` first)
  - physical iOS devices still report `memory` and `cpu` as unavailable in this release
- `fps` is still unavailable on all platforms in this release.
- If no startup sample exists yet for the session, run `open <app|url>` first and retry `perf`.
- If the session has no app package/bundle ID yet, `memory` and `cpu` remain unavailable until you `open <app>`.
- Interpretation note: this startup metric is command round-trip timing and does not represent true first frame / first interactive app instrumentation.
- CPU data is a lightweight process snapshot, so an idle app may legitimately read as `0`.

## Media and logs

```bash
agent-device screenshot                 # Auto filename
agent-device screenshot page.png        # Explicit screenshot path
agent-device screenshot page.png --overlay-refs  # Draw current @eN refs and target rectangles onto the PNG
agent-device screenshot textedit.png    # App-session window capture on macOS
agent-device screenshot --fullscreen    # Force full-screen capture on macOS app sessions
agent-device open --platform macos --surface desktop && agent-device screenshot desktop.png
agent-device record start               # Start screen recording to auto filename
agent-device record start session.mp4   # Start recording to explicit path
agent-device record start session.mp4 --fps 30  # Override iOS device runner FPS
agent-device record stop                # Stop active recording
```

- Recordings always produce a video artifact. When touch visualization is enabled, they also produce a gesture telemetry sidecar that can be used for post-processing or inspection.
- `screenshot --overlay-refs` captures a fresh full snapshot and burns visible `@eN` refs plus their target rectangles into the saved PNG.
- In `--json` mode, each overlay ref also includes a screenshot-space `center` point for coordinate fallback like `press <x> <y>`.
- Burned-in touch overlays are exported only on macOS hosts, because the overlay pipeline depends on Swift + AVFoundation helpers.
- On Linux or other non-macOS hosts, `record stop` still succeeds and returns the raw video plus telemetry sidecar, and includes `overlayWarning` when burn-in overlays were skipped.

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
agent-device network dump 25 --include all # Include parsed headers/body when available (truncated)
```

- Supported on iOS simulator, iOS physical device, and Android.
- Preferred debug entrypoint: `logs clear --restart` for clean-window repro loops.
- `logs start` appends to `app.log` and rotates to `app.log.1` when the file exceeds 5 MB.
- `network dump [limit] [summary|headers|body|all]` parses recent HTTP(s) entries from `app.log`; `network log ...` is an alias.
- Prefer `--include headers|body|all` when you want explicit detail level without relying on positional ordering.
- On macOS, `logs` and `network dump` are app-scoped and parse Unified Logging output associated with the active session app.
- Network dump limits: scans up to 4000 recent log lines, returns up to 200 entries, and truncates payload/header fields at 2048 characters.
- Android `network dump` also surfaces logcat timestamps and can backfill status and duration from adjacent GIBSDK packet lines when the URL is logged separately.
- Android log streaming automatically rebinds to the app PID after process restarts.
- iOS simulator log capture now streams from inside the simulator with `simctl spawn <udid> log ...`, and `network dump` can recover recent simulator log history with `simctl log show` when the live app-log window is sparse.
- iOS log capture still relies on Unified Logging signals (for example `os_log`); plain stdout/stderr output may be limited depending on app/runtime.
- On iOS, `network dump` can return zero HTTP entries for real app activity when the app does not emit request metadata into Unified Logging. The response notes now distinguish between an empty repro window and a non-network app log window.
- Retention knobs: set `AGENT_DEVICE_APP_LOG_MAX_BYTES` and `AGENT_DEVICE_APP_LOG_MAX_FILES` to override rotation limits.
- Optional write-time redaction patterns: set `AGENT_DEVICE_APP_LOG_REDACT_PATTERNS` to a comma-separated regex list.

**Grepping app logs:** Use `logs path` to get the file path, then run `grep` (or `grep -E`) on that path so only matching lines enter context—keeping token use low.

```bash
# Get path first (e.g. ~/.agent-device/sessions/default/app.log)
agent-device logs path

# Then grep the path; -n adds line numbers for reference
grep -n "Error\|Exception\|Fatal" ~/.agent-device/sessions/default/app.log
grep -n -E "Error|Exception|Fatal|crash" ~/.agent-device/sessions/default/app.log
grep -n -E "agent-device.*mark|before submit" ~/.agent-device/sessions/default/app.log

# Last 50 lines only (bounded context)
tail -50 ~/.agent-device/sessions/default/app.log
```

- Use `-n` to include line numbers. Use `-E` for extended regex and `|` without escaping in the pattern.

- Prefer targeted patterns (e.g. `Error`, `Exception`, your log tags) over reading the whole file.

- `logs mark "before submit"` lines are prefixed with `[agent-device][mark][...]`, so grep for `agent-device.*mark` when you need timing markers back quickly.

- iOS `record` works on simulators and physical devices.

- iOS simulator recording uses native `simctl io ... recordVideo`.

- Physical iOS device capture is runner-based and built from repeated `XCUIScreen.main.screenshot()` frames (no native video stream/audio capture).

- Physical iOS device recording requires an active app session context (`open <app>` first).

- Physical iOS device capture is best-effort: dropped frames are expected and true 60 FPS is not guaranteed even with `--fps 60`.

- Physical-device capture defaults to 15 FPS.

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

## Remote Metro workflow

```bash
agent-device open com.example.myapp --remote-config ./agent-device.remote.json --relaunch
agent-device snapshot -i --remote-config ./agent-device.remote.json
agent-device metro prepare --remote-config ./agent-device.remote.json --json
```

- `--remote-config <path>` points to a remote workflow profile that captures stable host + Metro settings.
- `open --remote-config ... --relaunch` is the main agent flow. It prepares Metro locally, derives platform runtime hints, and forwards them inline to the remote daemon before launch.
- `snapshot`, `press`, `fill`, `screenshot`, and other normal commands can reuse the same `--remote-config` profile so agents do not need to repeat remote host/session selectors inline.
- `metro prepare --remote-config ...` remains the inspection/debug path and can still write a `--runtime-file <path>` artifact when needed.

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
