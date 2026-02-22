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
- Platforms: iOS (simulator + physical device core automation) and Android (emulator + device).
- Core commands: `open`, `back`, `home`, `app-switcher`, `press`, `long-press`, `focus`, `type`, `fill`, `scroll`, `scrollintoview`, `wait`, `alert`, `screenshot`, `close`, `reinstall`.
- Inspection commands: `snapshot` (accessibility tree), `diff snapshot` (structural baseline diff), `appstate`, `apps`, `devices`.
- App logs: `logs path` returns session log metadata; `logs start` / `logs stop` stream app output; `logs doctor` checks readiness; `logs mark` writes timeline markers.
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
- `batch`
- `snapshot`, `diff snapshot`, `find`, `get`
- `press` (alias: `click`), `focus`, `type`, `fill`, `long-press`, `swipe`, `scroll`, `scrollintoview`, `pinch`, `is`
- `alert`, `wait`, `screenshot`
- `trace start`, `trace stop`
- `logs path`, `logs start`, `logs stop`, `logs doctor`, `logs mark` (session app log file for grep; iOS simulator + iOS device + Android)
- `settings wifi|airplane|location on|off`
- `settings faceid match|nonmatch|enroll|unenroll` (iOS simulator only)
- `appstate`, `apps`, `devices`, `session list`

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
- `--platform ios|android`
- `--device <name>`
- `--udid <udid>` (iOS)
- `--serial <serial>` (Android)
- `--activity <component>` (Android app launch only; package/Activity or package/.Activity; not for URL opens)
- `--session <name>`
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

Pinch:
- `pinch` is supported on iOS simulators.
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
- Session scripts are written to `~/.agent-device/sessions/<session>-<timestamp>.ad` when recording is enabled with `--save-script`.
- `--save-script` accepts an optional path: `--save-script ./workflows/my-flow.ad`.
- For ambiguous bare values, use an explicit form: `--save-script=workflow.ad` or a path-like value such as `./workflow.ad`.
- Deterministic replay is `.ad`-based; use `replay --update` (`-u`) to update selector drift and rewrite the replay file in place.
- On iOS, `appstate` is session-scoped and requires an active session on the target device.

Navigation helpers:
- `boot --platform ios|android` ensures the target is ready without launching an app.
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

Settings helpers:
- `settings wifi on|off`
- `settings airplane on|off`
- `settings location on|off` (iOS uses per-app permission for the current session app)
Note: iOS supports these only on simulators. iOS wifi/airplane toggles status bar indicators, not actual network state. Airplane off clears status bar overrides.

App state:
- `appstate` shows the foreground app/activity (Android).
- On iOS, `appstate` returns the currently tracked session app (`source: session`) and requires an active session on the selected device.
- `apps` includes default/system apps by default (use `--user-installed` to filter).

## Debug

- **App logs (token-efficient):** With an active session, run `logs path` to get path + state metadata (e.g. `~/.agent-device/sessions/<session>/app.log`). Run `logs start` to stream app output to that file; use `logs stop` to stop. Run `logs doctor` for tool/runtime checks and `logs mark "step"` to insert timeline markers. Grep the file when you need to inspect errors (e.g. `grep -n "Error\|Exception" <path>`) instead of pulling full logs into context. Supported on iOS simulator, iOS physical device, and Android.
- `logs start` appends to `app.log` and rotates to `app.log.1` when the file exceeds 5 MB.
- Android log streaming automatically rebinds to the app PID after process restarts.
- iOS log capture relies on Unified Logging signals (for example `os_log`); plain stdout/stderr output may be limited depending on app/runtime.
- Retention knobs: set `AGENT_DEVICE_APP_LOG_MAX_BYTES` and `AGENT_DEVICE_APP_LOG_MAX_FILES` to override rotation limits.
- Optional write-time redaction patterns: set `AGENT_DEVICE_APP_LOG_REDACT_PATTERNS` to a comma-separated regex list.
- `agent-device trace start`
- `agent-device trace stop ./trace.log`
- The trace log includes snapshot logs and XCTest runner logs for the session.
- Built-in retries cover transient runner connection failures and Android UI dumps.
- For snapshot issues (missing elements), compare with `--raw` flag for unaltered output and scope with `-s "<label>"`.
- If startup fails with stale metadata hints, remove stale `~/.agent-device/daemon.json` / `~/.agent-device/daemon.lock` and retry.

Boot diagnostics:
- Boot failures include normalized reason codes in `error.details.reason` (JSON mode) and verbose logs.
- Reason codes: `IOS_BOOT_TIMEOUT`, `IOS_RUNNER_CONNECT_TIMEOUT`, `ANDROID_BOOT_TIMEOUT`, `ADB_TRANSPORT_UNAVAILABLE`, `CI_RESOURCE_STARVATION_SUSPECTED`, `BOOT_COMMAND_FAILED`, `UNKNOWN`.
- Android boot waits fail fast for permission/tooling issues and do not always collapse into timeout errors.
- Use `agent-device boot --platform ios|android` when starting a new session only if `open` cannot find/connect to an available target.
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
- `AGENT_DEVICE_IOS_BOOT_TIMEOUT_MS=<ms>` to adjust iOS simulator boot timeout (default: `120000`, minimum: `5000`).
- `AGENT_DEVICE_DAEMON_TIMEOUT_MS=<ms>` to override daemon request timeout (default `90000`). Increase for slow physical-device setup (for example `120000`).
- `AGENT_DEVICE_IOS_TEAM_ID=<team-id>` optional Team ID override for iOS device runner signing.
- `AGENT_DEVICE_IOS_SIGNING_IDENTITY=<identity>` optional signing identity override.
- `AGENT_DEVICE_IOS_PROVISIONING_PROFILE=<profile>` optional provisioning profile specifier for iOS device runner signing.
- `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH=<path>` optional override for iOS runner derived data root. By default, simulator uses `~/.agent-device/ios-runner/derived` and physical device uses `~/.agent-device/ios-runner/derived/device`. If you set this override, use separate paths per kind to avoid simulator/device artifact collisions.
- `AGENT_DEVICE_IOS_CLEAN_DERIVED=1` rebuild iOS runner artifacts from scratch for runtime daemon-triggered builds (`pnpm ad ...`) on the selected path. `pnpm build:xcuitest`/`pnpm build:all` already clear `~/.agent-device/ios-runner/derived/device` and do not require this variable. When `AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH` is set, cleanup is blocked by default; set `AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN=1` only for trusted custom paths.

Test screenshots are written to:
- `test/screenshots/android-settings.png`
- `test/screenshots/ios-settings.png`

## Contributing
See `CONTRIBUTING.md`.

## Made at Callstack

agent-device is an open source project and will always remain free to use. Callstack is a group of React and React Native geeks. Contact us at hello@callstack.com if you need any help with these technologies or just want to say hi.
