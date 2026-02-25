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
- Platforms: iOS/tvOS (simulator + physical device core automation) and Android/AndroidTV (emulator + device).
- Core commands: `open`, `back`, `home`, `app-switcher`, `press`, `long-press`, `focus`, `type`, `fill`, `scroll`, `scrollintoview`, `wait`, `alert`, `screenshot`, `close`, `reinstall`, `push`, `trigger-app-event`.
- Inspection commands: `snapshot` (accessibility tree), `diff snapshot` (structural baseline diff), `appstate`, `apps`, `devices`.
- Clipboard commands: `clipboard read`, `clipboard write <text>`.
- Performance command: `perf` (alias: `metrics`) returns a metrics JSON blob for the active session; startup timing is currently sampled.
- App logs and traffic inspection: `logs path` returns session log metadata; `logs start` / `logs stop` stream app output; `logs clear` truncates session app logs; `logs clear --restart` resets and restarts stream in one step; `logs doctor` checks readiness; `logs mark` writes timeline markers; `network dump` parses recent HTTP(s) entries from session logs.
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

The skill is also accessible on [ClawHub](https://clawhub.ai/okwasniewski/agent-device).
For structured exploratory QA workflows, use the dogfood skill at [skills/dogfood/SKILL.md](skills/dogfood/SKILL.md).

## Quick Start

Use refs for agent-driven exploration and normal automation flows.
Use `press` as the canonical tap command; `click` is an equivalent alias.

```bash
agent-device open Contacts --platform ios # creates session on iOS Simulator
agent-device snapshot
agent-device press @e5
agent-device diff snapshot # subsequent runs compare against previous baseline
agent-device fill @e6 "John"
agent-device fill @e7 "Doe"
agent-device press @e3
agent-device close
```

## Fast batching (JSON steps)

Use `batch` to execute multiple commands in a single daemon request.

CLI examples:

```bash
agent-device batch \
  --session sim \
  --platform ios \
  --udid 00008150-001849640CF8401C \
  --steps-file /tmp/batch-steps.json \
  --json
```

Small inline payloads are also supported:

```bash
agent-device batch --steps '[{"command":"open","positionals":["settings"]},{"command":"wait","positionals":["100"]}]'
```

Batch payload format:

```json
[
  { "command": "open", "positionals": ["settings"], "flags": {} },
  { "command": "wait", "positionals": ["label=\"Privacy & Security\"", "3000"], "flags": {} },
  { "command": "click", "positionals": ["label=\"Privacy & Security\""], "flags": {} },
  { "command": "get", "positionals": ["text", "label=\"Tracking\""], "flags": {} }
]
```

Batch response includes:

- `total`, `executed`, `totalDurationMs`
- per-step `results[]` with `durationMs`
- failure context with failing `step` and `partialResults`

Agent usage guidelines:

- Keep each batch to one screen-local workflow.
- Add sync guards (`wait`, `is exists`) after mutating steps (`open`, `click`, `fill`, `swipe`).
- Treat refs/snapshot assumptions as stale after UI mutations.
- Prefer `--steps-file` over inline JSON for reliability.
- Keep batches moderate (about 5-20 steps) and stop on first error.

## CLI Usage

```bash
agent-device <command> [args] [--json]
```

Basic flow:

```bash
agent-device open SampleApp
agent-device snapshot
agent-device press @e7
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
- All coordinate-based commands (`press`, `longpress`, `swipe`, `focus`, `fill`) use device coordinates with origin at top-left.
- X increases to the right, Y increases downward.
- `press` is the canonical tap command.
- `click` is an equivalent alias and accepts the same targets (`x y`, `@ref`, selector) and flags.

Gesture series examples:

```bash
agent-device press 300 500 --count 12 --interval-ms 45
agent-device press 300 500 --count 6 --hold-ms 120 --interval-ms 30 --jitter-px 2
agent-device press @e5 --count 5 --double-tap
agent-device swipe 540 1500 540 500 120 --count 8 --pause-ms 30 --pattern ping-pong
agent-device scrollintoview "Sign in"
agent-device scrollintoview @e42
```

## Command Index
- `boot`, `open`, `close`, `reinstall`, `home`, `back`, `app-switcher`
- `push`
- `batch`
- `snapshot`, `diff snapshot`, `find`, `get`
- `press` (alias: `click`), `focus`, `type`, `fill`, `long-press`, `swipe`, `scroll`, `scrollintoview`, `pinch`, `is`
- `alert`, `wait`, `screenshot`
- `trigger-app-event <event> [payloadJson]`
- `trace start`, `trace stop`
- `logs path`, `logs start`, `logs stop`, `logs clear`, `logs clear --restart`, `logs doctor`, `logs mark` (session app log file for grep; iOS simulator + iOS device + Android)
- `clipboard read`, `clipboard write <text>` (iOS simulator + Android)
- `network dump [limit] [summary|headers|body|all]`, `network log ...` (best-effort HTTP(s) parsing from session app log)
- `settings wifi|airplane|location on|off`
- `settings appearance light|dark|toggle`
- `settings faceid match|nonmatch|enroll|unenroll` (iOS simulator only)
- `settings touchid match|nonmatch|enroll|unenroll` (iOS simulator only)
- `settings fingerprint match|nonmatch` (Android emulator/device where supported)
- `settings permission grant|deny|reset camera|microphone|photos|contacts|notifications [full|limited]`
- `appstate`, `apps`, `devices`, `session list`
- `perf` (alias: `metrics`)

Push notification simulation:

```bash
# iOS simulator: app bundle + payload file
agent-device push com.example.app ./payload.apns --platform ios --device "iPhone 16"

# iOS simulator: inline JSON payload
agent-device push com.example.app '{"aps":{"alert":"Welcome","badge":1}}' --platform ios

# Android: package + payload (action/extras map)
agent-device push com.example.app '{"action":"com.example.app.PUSH","extras":{"title":"Welcome","unread":3,"promo":true}}' --platform android
```

Payload notes:
- iOS uses `xcrun simctl push <device> <bundle> <payload>` and requires APNs-style JSON object (for example `{"aps":{"alert":"..."}}`).
- Android uses `adb shell am broadcast` with payload JSON shape:
  `{"action":"<intent-action>","receiver":"<optional component>","extras":{"key":"value","flag":true,"count":3}}`.
- Android extras support string/boolean/number values.
- `push` works with session context (uses session device) or explicit device selectors.

App event triggers (app hook):

```bash
agent-device trigger-app-event screenshot_taken '{"source":"qa"}'
```

- `trigger-app-event` dispatches an app event via deep link and requires an app-side test/debug hook.
- `trigger-app-event` requires either an active session or explicit device selectors (`--platform`, `--device`, `--udid`, `--serial`).
- On iOS physical devices, custom-scheme deep links require active app context (open the app in-session first).
- Configure one of:
  - `AGENT_DEVICE_APP_EVENT_URL_TEMPLATE`
  - `AGENT_DEVICE_IOS_APP_EVENT_URL_TEMPLATE`
  - `AGENT_DEVICE_ANDROID_APP_EVENT_URL_TEMPLATE`
- Template placeholders: `{event}`, `{payload}`, `{platform}`.
- Example template: `myapp://agent-device/event?name={event}&payload={payload}`.
- `payloadJson` must be a JSON object.
- This is app-hook-based simulation, not an OS-global notification injector.
- Canonical trigger contract lives in [`website/docs/docs/commands.md`](website/docs/docs/commands.md) under **App event triggers**.

## iOS Snapshots

Notes:
- iOS snapshots use XCTest on simulators and physical devices.
- Scope snapshots with `-s "<label>"` or `-s @ref`.
- If XCTest returns 0 nodes (e.g., foreground app changed), agent-device fails explicitly.
- `diff snapshot` uses the same snapshot flags and compares the current capture with the previous session baseline, then updates baseline.

Diff snapshots:
- Run `diff snapshot` once to initialize baseline for the current session.
- Run `diff snapshot` again after UI changes to get unified-style output (`-` removed, `+` added, unchanged context).
- Use `--json` to get `{ mode, baselineInitialized, summary, lines }`.

Efficient snapshot usage:
- Default to `snapshot -i` for iterative agent loops.
- Add `-s "<label>"` (or `-s @ref`) for screen-local work to reduce payload size.
- Add `-d <depth>` when lower tree levels are not needed.
- Re-snapshot after UI mutations before reusing refs.
- Use `diff snapshot` for low-noise structural change verification between adjacent states.
- Reserve `--raw` for troubleshooting and parser/debug investigations.

Flags:
- `--version, -V` print version and exit
- `--platform ios|android|apple` (`apple` aliases the iOS/tvOS backend)
- `--target mobile|tv` select device class within platform (requires `--platform`; for example AndroidTV/tvOS)
- `--device <name>`
- `--udid <udid>` (iOS)
- `--serial <serial>` (Android)
- `--ios-simulator-device-set <path>` constrain iOS simulator discovery/commands to one simulator set (`xcrun simctl --set`)
- `--android-device-allowlist <serials>` constrain Android discovery/selection to comma/space-separated serials
- `--activity <component>` (Android app launch only; package/Activity or package/.Activity; not for URL opens)
- `--session <name>`
- `--state-dir <path>` daemon state directory override (default: `~/.agent-device`)
- `--daemon-transport auto|socket|http` daemon client transport preference
- `--daemon-server-mode socket|http|dual` daemon server mode (`http` and `dual` expose JSON-RPC over HTTP at `/rpc`)
- `--tenant <id>` tenant identifier used with session isolation
- `--session-isolation none|tenant` explicit session isolation mode (`tenant` scopes session namespace as `<tenant>:<session>`)
- `--run-id <id>` run identifier used with tenant-scoped lease admission
- `--lease-id <id>` active lease identifier used with tenant-scoped lease admission
- `--count <n>` repeat count for `press`/`swipe`
- `--interval-ms <ms>` delay between `press` iterations
- `--hold-ms <ms>` hold duration per `press` iteration
- `--jitter-px <n>` deterministic coordinate jitter for `press`
- `--double-tap` use a double-tap gesture per `press`/`click` iteration (cannot be combined with `--hold-ms` or `--jitter-px`)
- `--pause-ms <ms>` delay between `swipe` iterations
- `--pattern one-way|ping-pong` repeat pattern for `swipe`
- `--debug` (alias: `--verbose`) for debug diagnostics + daemon/runner logs
- `--json` for structured output
- `--steps <json>` batch: JSON array of steps
- `--steps-file <path>` batch: read step JSON from file
- `--on-error stop` batch: stop when a step fails
- `--max-steps <n>` batch: max allowed steps per request

Isolation precedence:
- Discovery scope (`--ios-simulator-device-set`, `--android-device-allowlist`) is applied before selector matching (`--device`, `--udid`, `--serial`).
- If a selector points outside the scoped set/allowlist, command resolution fails with `DEVICE_NOT_FOUND` (no host-global fallback).
- When `--ios-simulator-device-set` is set (or its env equivalent), iOS discovery is simulator-set only (physical iOS devices are not enumerated).

TV targets:
- Use `--target tv` together with `--platform ios|android|apple`.
- TV target selection supports both simulator/emulator and connected physical devices (AppleTV + AndroidTV).
- AndroidTV app launch/app listing use TV launcher discovery (`LEANBACK_LAUNCHER`) and fallback component resolution when needed.
- tvOS uses the same runner-driven interaction/snapshot flow as iOS (`snapshot`, `wait`, `press`, `fill`, `get`, `scroll`, `back`, `home`, `app-switcher`, `record`, and related selector flows).
- tvOS back/home/app-switcher use Siri Remote semantics in the runner (`menu`, `home`, double-home).
- tvOS follows iOS simulator-only command semantics for helpers like `pinch`, `settings`, and `push`.

Examples:
- `agent-device open YouTube --platform android --target tv`
- `agent-device apps --platform android --target tv`
- `agent-device open Settings --platform ios --target tv`
- `agent-device screenshot ./apple-tv.png --platform ios --target tv`

Pinch:
- `pinch` is supported on iOS simulators (including tvOS simulator targets).
- On Android, `pinch` currently returns `UNSUPPORTED_OPERATION` in the adb backend.

Swipe timing:
- `swipe` accepts optional `durationMs` (default `250`, range `16..10000`).
- Android uses requested swipe duration directly.
- iOS clamps swipe duration to a safe range (`16..60ms`) to avoid longpress side effects.
- `scrollintoview` accepts either plain text or a snapshot ref (`@eN`); ref mode uses best-effort geometry-based scrolling without post-scroll verification. Run `snapshot` again before follow-up `@ref` commands.

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
- Session scripts are written to `<state-dir>/sessions/<session>-<timestamp>.ad` when recording is enabled with `--save-script`.
- `--save-script` accepts an optional path: `--save-script ./workflows/my-flow.ad`.
- For ambiguous bare values, use an explicit form: `--save-script=workflow.ad` or a path-like value such as `./workflow.ad`.
- Deterministic replay is `.ad`-based; use `replay --update` (`-u`) to update selector drift and rewrite the replay file in place.
- On iOS, `appstate` is session-scoped and requires an active session on the target device.

Navigation helpers:
- `boot --platform ios|android|apple` ensures the target is ready without launching an app.
- Use `boot` mainly when starting a new session and `open` fails because no booted simulator/emulator is available.
- `open [app|url] [url]` already boots/activates the selected target when needed.
- `reinstall <app> <path>` uninstalls and installs the app binary in one command (Android + iOS simulator/device).
- `reinstall` accepts package/bundle id style app names and supports `~` in paths.

Deep links:
- `open <url>` supports deep links with `scheme://...`.
- `open <app> <url>` opens a deep link on iOS.
- Android opens deep links via `VIEW` intent.
- iOS simulator opens deep links via `simctl openurl`.
- iOS device opens deep links via `devicectl --payload-url`.
- On iOS devices, `http(s)://` URLs open in Safari when no app is active. Custom scheme URLs (`myapp://`) require an active app in the session.
- `--activity` cannot be combined with URL opens.

```bash
agent-device open "myapp://home" --platform android
agent-device open "https://example.com" --platform ios          # open link in web browser
agent-device open MyApp "myapp://screen/to" --platform ios      # open deep link to MyApp
```

Find (semantic):
- `find <text> <action> [value]` finds by any text (label/value/identifier) using a scoped snapshot.
- `find text|label|value|role|id <value> <action> [value]` for specific locators.
- Actions: `click` (default), `fill`, `type`, `focus`, `get text`, `get attrs`, `wait [timeout]`, `exists`.

Assertions:
- `is` predicates: `visible`, `hidden`, `exists`, `editable`, `selected`, `text`.
- `is text` uses exact equality.

Performance metrics:
- `perf` (or `metrics`) requires an active session and returns a JSON metrics blob.
- Current metric: `startup` sampled from the elapsed wall-clock time around each session `open` command dispatch (`open-command-roundtrip`), unit `ms`.
- Startup samples are session-scoped and include sample history from recent `open` actions.
- Platform support for current sampling: iOS simulator, iOS physical device, Android emulator/device.
- `fps`, `memory`, and `cpu` are reported as not yet implemented in this release.
- Quick usage:

```bash
agent-device open Settings --platform ios
agent-device perf --json
```

- How to read it:
  - `metrics.startup.lastDurationMs`: most recent startup sample in milliseconds.
  - `metrics.startup.samples[]`: recent startup history for this session.
  - `sampling.startup.method`: currently `open-command-roundtrip`.
- Caveat: startup here is command-to-launch round-trip timing, not true app TTI/first-interactive telemetry.

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
- Some Android system images cannot inject non-ASCII text (for example Chinese or emoji) through shell input.
- If this occurs, install an ADB keyboard IME from a trusted source, verify checksum/signature, and enable it only for test sessions:
  - Trusted sources: https://github.com/senzhk/ADBKeyBoard or https://f-droid.org/packages/com.android.adbkeyboard/
  - `adb -s <serial> install <path-to-adbkeyboard.apk>`
  - `adb -s <serial> shell ime enable com.android.adbkeyboard/.AdbIME`
  - `adb -s <serial> shell ime set com.android.adbkeyboard/.AdbIME`
  - `adb -s <serial> shell ime list -s` (verify current/default IME)

Settings helpers:
- `settings wifi on|off`
- `settings airplane on|off`
- `settings location on|off` (iOS uses per-app permission for the current session app)
- `settings appearance light|dark|toggle` (iOS simulator appearance + Android night mode)
- `settings faceid|touchid match|nonmatch|enroll|unenroll` (iOS simulator only)
- `settings fingerprint match|nonmatch` (Android emulator/device where supported)
  On physical Android devices, fingerprint simulation depends on `cmd fingerprint` support.
- `settings permission grant|deny|reset <camera|microphone|photos|contacts|notifications> [full|limited]` (session app required)
Note: iOS supports these only on simulators. iOS wifi/airplane toggles status bar indicators, not actual network state. Airplane off clears status bar overrides.
- iOS permission targets map to `simctl privacy`: `camera`, `microphone`, `photos` (`full` => `photos`, `limited` => `photos-add`), `contacts`, `notifications`.
- Android permission targets: `camera`, `microphone`, `photos`, `contacts` use `pm grant|revoke` (`reset` maps to `pm revoke`); `notifications` uses `appops set POST_NOTIFICATION allow|deny|default`.
- `full|limited` mode is valid only for iOS `photos`; other targets reject mode.

App state:
- `appstate` shows the foreground app/activity (Android).
- On iOS, `appstate` returns the currently tracked session app (`source: session`) and requires an active session on the selected device.
- `apps` includes default/system apps by default (use `--user-installed` to filter).

Clipboard:
- `clipboard read` returns current clipboard text.
- `clipboard write <text>` sets clipboard text (`clipboard write ""` clears it).
- Supported on Android emulator/device and iOS simulator.
- iOS physical devices currently return `UNSUPPORTED_OPERATION` for clipboard commands.

## Debug

- **App logs (token-efficient):** Logging is off by default in normal flows. Enable it on demand when debugging. With an active session, run `logs path` to get path + state metadata (e.g. `<state-dir>/sessions/<session>/app.log`). Run `logs start` to stream app output to that file; use `logs stop` to stop. Run `logs clear` to truncate `app.log` (and remove rotated `app.log.N` files) before a new repro window. Run `logs doctor` for tool/runtime checks and `logs mark "step"` to insert timeline markers. Grep the file when you need to inspect errors (e.g. `grep -n "Error\|Exception" <path>`) instead of pulling full logs into context. Supported on iOS simulator, iOS physical device, and Android.
- Use `logs clear --restart` when you want one command to stop an active stream, clear current logs, and immediately resume streaming.
- `logs start` appends to `app.log` and rotates to `app.log.1` when the file exceeds 5 MB.
- **Network dump (best-effort):** `network dump [limit] [summary|headers|body|all]` parses recent HTTP(s) lines from the same session app log file and returns method/url/status with optional headers/bodies. `network log ...` is an alias. Current limits: scans up to 4000 recent log lines, returns up to 200 entries, truncates payload/header fields at 2048 characters.
- Android log streaming automatically rebinds to the app PID after process restarts.
- Detailed playbook: `skills/agent-device/references/logs-and-debug.md`
- iOS log capture relies on Unified Logging signals (for example `os_log`); plain stdout/stderr output may be limited depending on app/runtime.
- Retention knobs: set `AGENT_DEVICE_APP_LOG_MAX_BYTES` and `AGENT_DEVICE_APP_LOG_MAX_FILES` to override rotation limits.
- Optional write-time redaction patterns: set `AGENT_DEVICE_APP_LOG_REDACT_PATTERNS` to a comma-separated regex list.
- `agent-device trace start`
- `agent-device trace stop ./trace.log`
- The trace log includes snapshot logs and XCTest runner logs for the session.
- Built-in retries cover transient runner connection failures and Android UI dumps.
- For snapshot issues (missing elements), compare with `--raw` flag for unaltered output and scope with `-s "<label>"`.
- If startup fails with stale metadata hints, remove stale `<state-dir>/daemon.json` / `<state-dir>/daemon.lock` and retry (state dir defaults to `~/.agent-device` unless overridden).

Boot diagnostics:
- Boot failures include normalized reason codes in `error.details.reason` (JSON mode) and verbose logs.
- Reason codes: `IOS_BOOT_TIMEOUT`, `IOS_RUNNER_CONNECT_TIMEOUT`, `ANDROID_BOOT_TIMEOUT`, `ADB_TRANSPORT_UNAVAILABLE`, `CI_RESOURCE_STARVATION_SUSPECTED`, `BOOT_COMMAND_FAILED`, `UNKNOWN`.
- Android boot waits fail fast for permission/tooling issues and do not always collapse into timeout errors.
- Use `agent-device boot --platform ios|android|apple` when starting a new session only if `open` cannot find/connect to an available target.
- Android emulator boot by AVD name (GUI): `agent-device boot --platform android --device Pixel_9_Pro_XL`.
- Android headless emulator boot: `agent-device boot --platform android --device Pixel_9_Pro_XL --headless`.
- `--debug` captures retry telemetry in diagnostics logs.
- Set `AGENT_DEVICE_RETRY_LOGS=1` to also print retry telemetry directly to stderr (ad-hoc troubleshooting).

Diagnostics files:
- Failed commands persist diagnostics in `~/.agent-device/logs/<session>/<date>/<timestamp>-<diagnosticId>.ndjson`.
- `--debug` persists diagnostics for successful commands too and streams live diagnostic events.
- JSON failures include `error.hint`, `error.diagnosticId`, and `error.logPath`.

## App resolution
- Bundle/package identifiers are accepted directly (e.g., `com.apple.Preferences`).
- Human-readable names are resolved when possible (e.g., `Settings`).
- Built-in aliases include `Settings` for both platforms.

## iOS notes
- Core runner commands: `snapshot`, `wait`, `click`, `fill`, `get`, `is`, `find`, `press`, `longpress`, `focus`, `type`, `scroll`, `scrollintoview`, `back`, `home`, `app-switcher`.
- Simulator-only commands: `alert`, `pinch`, `settings`.
- tvOS targets are selectable (`--platform ios --target tv` or `--platform apple --target tv`) and support runner-driven interaction/snapshot commands.
- `record` supports iOS simulators and physical iOS devices.
  - iOS simulator recording uses native `simctl io ... recordVideo`.
  - Physical iOS device recording is runner-based and built from repeated `XCUIScreen.main.screenshot()` frames (no native video stream/audio capture).
  - Physical iOS device recording requires an active app session context (`open <app>` first) so capture targets your app instead of the runner host app.
  - Physical iOS device capture is best-effort: dropped frames are expected and true 60 FPS is not guaranteed even with `--fps 60`.
  - Physical iOS device recording defaults to uncapped (max available) FPS.
  - Use `agent-device record start [path] --fps <n>` (1-120) to set an explicit FPS cap on physical iOS devices.
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
- `AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET=<path>` (or `IOS_SIMULATOR_DEVICE_SET=<path>`) to scope all iOS simulator discovery/commands to one simulator set.
- `AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST=<serials>` (or `ANDROID_DEVICE_ALLOWLIST=<serials>`) to scope Android discovery to allowlisted serials.
- CLI flags `--ios-simulator-device-set` / `--android-device-allowlist` override environment values.
- `AGENT_DEVICE_IOS_BOOT_TIMEOUT_MS=<ms>` to adjust iOS simulator boot timeout (default: `120000`, minimum: `5000`).
- `AGENT_DEVICE_DAEMON_TIMEOUT_MS=<ms>` to override daemon request timeout (default `90000`). Increase for slow physical-device setup (for example `120000`).
- `AGENT_DEVICE_STATE_DIR=<path>` override daemon state directory (metadata, logs, session artifacts).
- `AGENT_DEVICE_DAEMON_SERVER_MODE=socket|http|dual` daemon server mode. `http` and `dual` expose JSON-RPC 2.0 at `POST /rpc` (`GET /health` available for liveness).
- `AGENT_DEVICE_DAEMON_TRANSPORT=auto|socket|http` client preference when connecting to daemon metadata.
- `AGENT_DEVICE_HTTP_AUTH_HOOK=<module-path>` optional HTTP auth hook module path for JSON-RPC server mode.
- `AGENT_DEVICE_HTTP_AUTH_EXPORT=<export-name>` optional export name from auth hook module (default: `default`).
- `AGENT_DEVICE_MAX_SIMULATOR_LEASES=<n>` optional max concurrent simulator leases for HTTP lease allocation (default: unlimited).
- `AGENT_DEVICE_LEASE_TTL_MS=<ms>` default lease TTL used by `agent_device.lease.allocate` and `agent_device.lease.heartbeat` (default: `60000`).
- `AGENT_DEVICE_LEASE_MIN_TTL_MS=<ms>` minimum accepted lease TTL (default: `5000`).
- `AGENT_DEVICE_LEASE_MAX_TTL_MS=<ms>` maximum accepted lease TTL (default: `600000`).
- `AGENT_DEVICE_IOS_TEAM_ID=<team-id>` optional Team ID override for iOS device runner signing.
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY=<identity>` optional signing identity override.
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE=<profile>` optional provisioning profile specifier for iOS device runner signing.
- `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH=<path>` optional override for iOS runner derived data root. By default, simulator uses `~/.agent-device/ios-runner/derived` and physical device uses `~/.agent-device/ios-runner/derived/device`. If you set this override, use separate paths per kind to avoid simulator/device artifact collisions.
- `AGENT_DEVICE_IOS_CLEAN_DERIVED=1` rebuild iOS runner artifacts from scratch for runtime daemon-triggered builds (`pnpm ad ...`) on the selected path. `pnpm build:xcuitest` (alias of `pnpm build:xcuitest:ios`), `pnpm build:xcuitest:tvos`, and `pnpm build:all` already clear their default derived paths and do not require this variable. When `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH` is set, cleanup is blocked by default; set `AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN=1` only for trusted custom paths.

Test screenshots are written to:
- `test/screenshots/android-settings.png`
- `test/screenshots/ios-settings.png`

## Contributing
See `CONTRIBUTING.md`.

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
