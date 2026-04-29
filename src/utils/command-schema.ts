import { SETTINGS_USAGE_OVERRIDE } from '../core/settings-contract.ts';
import { SESSION_SURFACES } from '../core/session-surface.ts';
import type { DaemonInstallSource } from '../contracts.ts';

export type CliFlags = {
  json: boolean;
  config?: string;
  remoteConfig?: string;
  stateDir?: string;
  daemonBaseUrl?: string;
  daemonAuthToken?: string;
  daemonTransport?: 'auto' | 'socket' | 'http';
  daemonServerMode?: 'socket' | 'http' | 'dual';
  tenant?: string;
  sessionIsolation?: 'none' | 'tenant';
  runId?: string;
  leaseId?: string;
  leaseBackend?: 'ios-simulator' | 'ios-instance' | 'android-instance';
  force?: boolean;
  noLogin?: boolean;
  sessionLock?: 'reject' | 'strip';
  sessionLocked?: boolean;
  sessionLockConflicts?: 'reject' | 'strip';
  platform?: 'ios' | 'macos' | 'android' | 'linux' | 'apple';
  target?: 'mobile' | 'tv' | 'desktop';
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
  out?: string;
  session?: string;
  runtime?: string;
  metroHost?: string;
  metroPort?: number;
  metroProjectRoot?: string;
  metroKind?: 'auto' | 'react-native' | 'expo';
  metroPublicBaseUrl?: string;
  metroProxyBaseUrl?: string;
  metroBearerToken?: string;
  metroPreparePort?: number;
  metroListenHost?: string;
  metroStatusHost?: string;
  metroStartupTimeoutMs?: number;
  metroProbeTimeoutMs?: number;
  metroRuntimeFile?: string;
  metroNoReuseExisting?: boolean;
  metroNoInstallDeps?: boolean;
  bundleUrl?: string;
  launchUrl?: string;
  boot?: boolean;
  reuseExisting?: boolean;
  verbose?: boolean;
  snapshotInteractiveOnly?: boolean;
  snapshotDiff?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  networkInclude?: 'summary' | 'headers' | 'body' | 'all';
  overlayRefs?: boolean;
  screenshotFullscreen?: boolean;
  screenshotMaxSize?: number;
  baseline?: string;
  threshold?: string;
  appsFilter?: 'user-installed' | 'all';
  count?: number;
  fps?: number;
  quality?: number;
  hideTouches?: boolean;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pixels?: number;
  doubleTap?: boolean;
  clickButton?: 'primary' | 'secondary' | 'middle';
  backMode?: 'in-app' | 'system';
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  activity?: string;
  header?: string[];
  githubActionsArtifact?: string;
  installSource?: DaemonInstallSource;
  saveScript?: boolean | string;
  shutdown?: boolean;
  relaunch?: boolean;
  surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
  headless?: boolean;
  restart?: boolean;
  noRecord?: boolean;
  retainPaths?: boolean;
  retentionMs?: number;
  replayUpdate?: boolean;
  replayEnv?: string[];
  replayShellEnv?: Record<string, string>;
  failFast?: boolean;
  timeoutMs?: number;
  retries?: number;
  artifactsDir?: string;
  reportJunit?: string;
  steps?: string;
  stepsFile?: string;
  findFirst?: boolean;
  findLast?: boolean;
  batchOnError?: 'stop';
  batchMaxSteps?: number;
  batchSteps?: Array<{
    command: string;
    positionals?: string[];
    flags?: Record<string, unknown>;
  }>;
  help: boolean;
  version: boolean;
};

export type FlagKey = keyof CliFlags;
type FlagType = 'boolean' | 'int' | 'enum' | 'string' | 'booleanOrString';

export type FlagDefinition = {
  key: FlagKey;
  names: readonly string[];
  type: FlagType;
  multiple?: boolean;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  setValue?: CliFlags[FlagKey];
  usageLabel?: string;
  usageDescription?: string;
};

type CommandSchema = {
  helpDescription: string;
  summary?: string;
  positionalArgs: readonly string[];
  allowsExtraPositionals?: boolean;
  allowedFlags: readonly FlagKey[];
  defaults?: Partial<CliFlags>;
  skipCapabilityCheck?: boolean;
  usageOverride?: string;
  listUsageOverride?: string;
};

const SNAPSHOT_FLAGS = [
  'snapshotInteractiveOnly',
  'snapshotCompact',
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
] as const satisfies readonly FlagKey[];

const SELECTOR_SNAPSHOT_FLAGS = [
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
] as const satisfies readonly FlagKey[];

const FIND_SNAPSHOT_FLAGS = ['snapshotDepth', 'snapshotRaw'] as const satisfies readonly FlagKey[];

const AGENT_WORKFLOWS = [
  { label: 'help workflow', description: 'Normal bootstrap, exploration, and validation loop' },
  { label: 'help debugging', description: 'Logs, network, alerts, diagnostics, and traces' },
  {
    label: 'help react-devtools',
    description: 'React Native performance, profiling, component tree, and renders',
  },
  {
    label: 'help remote',
    description: 'Remote/cloud config, tenants, leases, and local service tunnels',
  },
  { label: 'help macos', description: 'Desktop, frontmost-app, and menu bar surfaces' },
  { label: 'help dogfood', description: 'Exploratory QA report workflow' },
] as const;

const AGENT_QUICKSTART_LINES = [
  'Default loop: devices/apps -> open -> snapshot -i -> press/fill/get/is/wait/find -> verify -> close.',
  'Use selectors or refs as positional targets: id="submit", label="Allow", or @e12 from snapshot -i.',
  'Plain snapshot reads state; snapshot -i is required to refresh interactive refs.',
  'Read-only visible/state question: use snapshot/get/is/find; use snapshot -i only when refs are needed.',
  'Truncated text/input preview: expand first with snapshot -s @e12, not get text.',
  'RN warning/error overlays can block taps: snapshot -i, dismiss/close, then diff snapshot -i.',
  'Expo Go/dev clients: use the provided URL when given; on iOS prefer open "Expo Go" <url>; Android URL opens infer the foreground package for logs/perf when possible.',
  'Install flows: install/install-from-source first, then open the installed id with --relaunch.',
  'Text: fill \'id="field-email"\' "qa@example.com" replaces; type appends after press.',
  'Clearing text: do not use fill <target> ""; use a visible clear/reset control or report that clearing is unsupported.',
  'Run mutating commands serially against one session; parallelize only read-only commands or separate sessions.',
  'Clipboard limits: iOS Allow Paste cannot be automated through XCUITest; prefill with clipboard write. Android non-ASCII should use fill/type, not raw adb input.',
  'After mutation: diff snapshot -i. Off-screen hints: scroll, then snapshot -i.',
  'Raw coordinates are fallback-only: use snapshot -i -c --json rects when iOS refs no-op or child refs are missing.',
  'Batch JSON steps use "command", "positionals", "flags"; never "args" or "step".',
  'Navigation: app-owned back uses back; system back uses back --system.',
  'Verification commands must name the expected text/selector; bare screenshots/snapshots are not enough.',
  'Debug evidence: logs clear --restart/mark/path; trace start ./path; trace stop ./path; network dump --include headers.',
  'Use agent-device commands in final plans; raw platform tools, pseudo commands, and helper prose are wrong.',
  'Full operating guide: agent-device help workflow. Exploratory QA: agent-device help dogfood.',
] as const;

const CONFIGURATION_LINES = [
  'Default config files: ~/.agent-device/config.json, ./agent-device.json',
  'Use --config <path> or AGENT_DEVICE_CONFIG to load one explicit config file.',
] as const;

const ENVIRONMENT_LINES = [
  { label: 'AGENT_DEVICE_SESSION', description: 'Default session name' },
  { label: 'AGENT_DEVICE_PLATFORM', description: 'Default platform binding' },
  { label: 'AGENT_DEVICE_SESSION_LOCK', description: 'Bound-session conflict mode' },
  { label: 'AGENT_DEVICE_DAEMON_BASE_URL', description: 'Connect to remote daemon' },
  {
    label: 'AGENT_DEVICE_DAEMON_AUTH_TOKEN',
    description: 'Remote daemon service/API token',
  },
  {
    label: 'AGENT_DEVICE_CLOUD_BASE_URL',
    description: 'Bridge/control-plane API origin for cloud auth and /api-keys',
  },
] as const;

const EXAMPLE_LINES = [
  'agent-device open Settings --platform ios',
  'agent-device open TextEdit --platform macos',
  'agent-device snapshot -i',
  'agent-device react-devtools get tree --depth 3',
  'agent-device fill @e3 "test@example.com"',
  'agent-device replay ./session.ad',
  'agent-device test ./suite --platform android',
] as const;

const HELP_TOPICS = {
  workflow: {
    summary: 'Normal agent-device bootstrap, exploration, and validation loop',
    body: `agent-device help workflow

Version-matched operating guide for normal agent-device work.

Core loop:
  devices/apps -> open -> snapshot or snapshot -i -> get/is/find/wait or press/fill/scroll/back -> verify -> close

Command shape:
  Plans should use agent-device commands, not raw platform tools, pseudo commands, package-manager aliases, or helper prose.
  Put subcommand first, then positionals, then flags:
    agent-device open com.example.app --session checkout --platform android --relaunch
    agent-device record start ./checkout.mp4 --session checkout
  Snapshot refs look like @e12. After snapshot -i, use the exact @eN ref from that output.
  If the exact ref is not known yet, first output snapshot -i, then use a concrete example shape like press @e12 in the next command; do not write @<ref>, @ref, @Label_Name, or @eN placeholders.
  Close means agent-device close. App-owned back means back; system back means back --system.
  Taps are press or click. Gestures are direct commands: swipe, longpress, pinch.

Bootstrap:
  agent-device devices --platform ios
  agent-device apps --platform android
  agent-device open MyApp --platform ios --device "iPhone 17 Pro"
  agent-device open <discovered-app-id> --session checkout --platform android
  agent-device install com.example.app ./dist/app.apk --platform android
  agent-device reinstall com.example.app ./build/MyApp.app --platform ios
  agent-device install-from-source --github-actions-artifact org/repo:app-debug --platform android
  agent-device open com.example.app --platform android --relaunch
  If app id is unknown, plan devices, apps, then open <discovered-app-id>. Discovery is not enough when the task asks to open/start the app.
  Install arguments are app/package id then artifact path. If the task says install, use install; use reinstall only when explicitly requested. Fresh runtime state is open --relaunch after install.
  Do not open artifact paths or invent package ids. If apps lookup misses the target and no URL/artifact is provided, ask or stop.

Snapshots and refs:
  snapshot reads visible state. snapshot -i gets current interactive refs.
  Snapshot legend:
    @e12 [button] label="Add to cart" id="add-cart" enabled hittable -> press @e12 or press 'id="add-cart"'.
    @e13 [textinput] label="Notes" preview="Leave at side..." truncated -> snapshot -s @e13 before reading.
    [off-screen below] 4 items: "Privacy", "About" -> scroll down, then snapshot -i; those are hints, not refs.
  Re-snapshot after navigation, submit, modal/list/reload/dynamic changes.
  Off-screen summaries are scroll hints; use scroll, not swipe, then snapshot -i.
  Missing target in a long list: use a short manual scroll + snapshot loop with a max attempt count; do not rely on unbounded scrollintoview.
  Truncated text/input previews: do not use get text first; expand with snapshot -s @ref (for example snapshot -s @e7), then read the scoped output.
  Rare iOS accessibility gaps: if a row ref is shown disabled/hittable:false and press @ref reports success but no UI change, or a horizontal tab/filter bar is collapsed into one composite/seekbar with no child refs, run agent-device snapshot -i -c --json to read rects, compute the target center, press x y, then diff snapshot -i. Coordinates are fallback-only; document why you used them.

Selectors:
  Use selectors as positional targets: id="field-email" or label="Allow".
  Do not use CSS selectors, pseudo refs, --selector, --text, or raw x/y when refs/selectors exist.
    agent-device fill 'id="catalog-search"' "tart" --delay-ms 80
    agent-device press 'id="submit-order"'
    agent-device is visible 'label="Online"'
    agent-device get text 'id="quantity-value"'

Text entry:
  fill replaces; type appends to focused field.
    agent-device fill @e5 "qa@example.com"
    agent-device fill 'id="field-email"' "qa@example.com"
    agent-device press 'id="product-note"'
    agent-device type "Handle with care" --delay-ms 80
  Empty replacement is not a supported clear-field command: do not plan fill <target> "" or fill <target> ''. Prefer a visible clear/reset control; if the app exposes none, report the tool gap instead of inventing a clear command.
  Debounced field with no result selector: agent-device wait 1000. Keyboard read-only: keyboard status/get. Blocked control: try keyboard dismiss when supported.
  On iOS, prefer keyboard dismiss before manually pressing visible Done; the runner can use safe native keyboard controls and still reports unsupported layouts explicitly. If it returns UNSUPPORTED_OPERATION, prefer a visible app dismiss control, or use back --system only when system navigation is an acceptable side effect.
  Search-as-you-type fields on iOS can drop characters when driven too fast; use --delay-ms on fill/type before trying clipboard paste.
  iOS Allow Paste prompt cannot be exercised under XCUITest. To test paste-driven app behavior, prefill first with agent-device clipboard write "some text"; test the system prompt manually.
  Android non-ASCII can fail on some system images. Try fill/type normally; agent-device uses safer fallbacks. If the shell reports unsupported non-ASCII input, configure a trusted ADB keyboard IME outside the command plan and restore the previous IME afterward.

Session ordering:
  Stateful commands against one --session must run serially. Do not run open/press/fill/type/scroll/back/alert/replay/batch/close commands in parallel against the same session.
  It is fine to parallelize independent read-only collection or commands that use different sessions/devices.

Read-only and waits:
  Read-only visible/state question: use snapshot/get/is/find.
  agent-device snapshot
  agent-device get text 'id="product-title"'
  agent-device get attrs @e4
  agent-device is visible 'label="Online"'
  agent-device wait text "Refreshing metrics..." 3000
  agent-device wait 'label="Ready"' 3000
  agent-device find "Increment" press --json
  For async/list text presence, prefer wait text over is visible when no interaction is needed.
  Use snapshot -i only when refs are needed for an action or targeted query.
  Ambiguous find: add --first or --last. If info is not visible/exposed, report that gap instead of typing/searching/navigating to reveal it.

Navigation and gestures:
  Use scroll for lists; swipe for coordinate gestures/carousels.
  If app-owned back is ambiguous or has just misrouted, prefer a visible nav/back button ref, tab-bar ref, or deep link over repeated back/system back.
  Keep count/pause/pattern on one swipe; flags are --count, --pause-ms, --pattern ping-pong.
  longpress duration and pinch scale/center are positional:
    agent-device longpress 300 500 800
    agent-device swipe 320 500 40 500 --count 8 --pause-ms 30 --pattern ping-pong
    agent-device pinch 0.5 200 400

Validation and evidence:
  Nearby mutation diff: agent-device diff snapshot -i.
  Expected text/selector verification must include the exact text or selector via wait, is, get, or find; bare screenshots/snapshots are insufficient for named expectations.
  Prefer provided testIDs/ids/selectors for verification; use visible text when no durable selector is provided.
  If task says snapshot, use snapshot. If it asks visual evidence, use screenshot.
  Icon/tappable visual proof: screenshot --overlay-refs. Flag is --overlay-refs.
  Startup/frame health/CPU/memory: perf --json or metrics. Replay maintenance: replay -u ./flow.ad.
  Recording: record start/stop. Tracing: trace start ./trace.log, trace stop ./trace.log. Paths are positional.
  Stable known flow: batch ./steps.json, not workflow batch.
  Inline batch JSON example:
    agent-device batch --steps '[{"command":"open","positionals":["settings"],"flags":{}},{"command":"wait","positionals":["100"],"flags":{}}]'
  Batch step keys are command, positionals, flags, and optional runtime. Never use args, step, text, or target as batch step fields.
  Android animations: settings animations off/on, not animations disable/restore.
  Debug logs: logs clear --restart, logs mark, reproduce, then logs path; do not split clear/restart into separate stop/start commands.
  Network headers: network dump --include headers; do not write network log headers.
  Remote config: connect --remote-config ./remote-config.json, open, snapshot, disconnect.
  macOS menu bar: open ... --platform macos --surface menubar; snapshot -i --platform macos --surface menubar.

React Native dev loop:
  JS-only change with Metro connected:
    agent-device metro reload
    agent-device find "Home"
  Do not use agent-device reload. Use open --relaunch for native startup reset.
  Warning/error overlays can obscure UI and intercept taps. If snapshot -i shows one, dismiss/close its visible control (for example Dismiss or Close) if it is not the task target, then diff snapshot -i or snapshot -i before tapping the real UI.
  Expo Go is a host shell. Use a provided project URL instead of inventing a bundle id; if no URL is provided but a target/app name is provided, open that target and do not inspect project files to find one. On iOS, prefer host + URL when the host shell is known because direct URL open can report success while leaving the runner/shell focused; verify with snapshot -i after opening:
    agent-device open "Expo Go" exp://127.0.0.1:8081 --platform ios
    agent-device snapshot -i --platform ios
  Direct iOS URL open remains valid when no host shell is known, but verify that the app UI loaded:
    agent-device open exp://127.0.0.1:8081 --platform ios
  Android uses the URL target directly; do not write open <app> <url> there:
    agent-device open exp://127.0.0.1:8081 --platform android
  Android URL/deep-link opens infer the foreground package after launch when possible, so logs/perf can remain package-bound. If perf still says no package is associated, open the host package/app id first, then open the URL in the same session.
  If apps lookup misses the project but shows Expo Go/dev-client and a project URL is available, open the URL/host shell; if no URL is available, ask instead of inventing an app id.
  Expo Dev Client/development builds: open the installed dev-client app id/name; if a dev-client URL is provided, open that URL next. For Metro setup use metro prepare --kind expo.

React DevTools minimum loop:
  Keep the agent-device react-devtools prefix on every React DevTools command:
    agent-device react-devtools status
    agent-device react-devtools wait --connected
    agent-device react-devtools profile start
    interact with normal agent-device commands
    agent-device react-devtools profile stop
    agent-device react-devtools profile slow --limit 5
    agent-device react-devtools profile rerenders --limit 5

Escalate:
  help debugging       logs, network, alerts, traces, flaky runtime failures
  help react-devtools  React Native performance, profiling, props/state/hooks, slow renders, rerenders
  help remote          remote/cloud config, tenant, lease, local service tunnels
  help macos           desktop, frontmost-app, menu bar surfaces
  help dogfood         exploratory QA report workflow`,
  },
  debugging: {
    summary: 'Targeted failure evidence without dumping stale context',
    body: `agent-device help debugging

Use this when behavior fails, hangs, times out, throws alerts, or needs runtime evidence.

Logs:
  Keep log windows small. Prefer clear, mark, reproduce, then path.
    agent-device logs clear --restart
    agent-device logs mark "before diagnostics retry"
    agent-device press 'id="load-diagnostics"'
    agent-device logs path
  Do not cat a full stale log into agent context. Open or grep only the relevant window when needed.
  logs clear --restart is the compact command to clear old logs and start a fresh capture; do not split it into logs stop, logs clear, logs start.

Network:
  Use network dump for recent session HTTP traffic parsed from app logs.
    agent-device network dump --include headers
    agent-device network dump 20 --include all
  Use this instead of logs path when the question is request/response metadata.
  network log is a supported alias, but network dump --include headers is the clearest plan form. Do not write network log headers.

Alerts:
  Native alerts:
    agent-device alert wait 3000
    agent-device alert accept
    agent-device alert dismiss
  If alert accept says no alert but a permission sheet is visibly on screen, treat it as normal UI:
    agent-device snapshot -i
    agent-device press 'label="Allow"'

Diagnostics and traces:
  Use --debug for CLI/daemon diagnostic ids and log paths.
  Use trace for low-level session diagnostics around one repro:
    agent-device trace start ./traces/diagnostics.trace
    agent-device press 'id="load-diagnostics"'
    agent-device trace stop ./traces/diagnostics.trace
  The trace path is positional. Do not use --path for trace start or trace stop.

Stabilizers:
  Android animation-sensitive flows:
    agent-device settings animations off
    agent-device snapshot
    agent-device settings animations on
  Re-enable settings you changed before finishing.

React Native internals:
  If the question is about React Native performance, profiling, props, state, hooks, render causes, slow components, or rerenders, use help react-devtools instead of inferring from screenshots or logs.`,
  },
  'react-devtools': {
    summary: 'React Native performance, profiling, and component internals',
    body: `agent-device help react-devtools

Use this for React Native performance/profiling and internals that the accessibility tree cannot expose: components, props, state, hooks, ownership, slow renders, and rerenders.

Core commands:
  agent-device react-devtools start
  agent-device react-devtools stop
  agent-device react-devtools status
  agent-device react-devtools wait --connected
  agent-device react-devtools wait --component <ComponentName>
  agent-device react-devtools count
  agent-device react-devtools get tree --depth 3
  agent-device react-devtools find <ComponentName>
  agent-device react-devtools find <ComponentName> --exact
  agent-device react-devtools get component @c5
  agent-device react-devtools errors
  agent-device react-devtools profile start
  agent-device react-devtools profile stop
  agent-device react-devtools profile slow --limit 5
  agent-device react-devtools profile rerenders --limit 5
  agent-device react-devtools profile report @c5
  agent-device react-devtools profile timeline --limit 20
  agent-device react-devtools profile export profile.json
  agent-device react-devtools profile diff before.json after.json --limit 10

Profiling loop:
  1. Verify the app is connected: react-devtools status, then wait --connected if needed.
  2. Start profiling immediately before the interaction.
  3. Drive the interaction with normal agent-device commands.
  4. Stop profiling.
  5. Inspect slow components and rerenders.
  6. Use profile report @cN for render causes and changed props/state/hooks; use get component @cN for current props/state/hooks.

Rules:
  Start with get tree --depth 3 or find <name>; use find --exact when fuzzy results are noisy.
  @c refs reset after reload/remount. After reload, wait --connected and inspect again.
  Keep the profile window narrow; unrelated navigation makes render data noisy.
  For cross-platform validation with explicit device selectors, prefer isolated --state-dir and restart react-devtools between platforms.
  Remote Android runs normally through agent-device react-devtools; the CLI manages the needed local service tunnel. Expo support depends on the SDK's bundled React Native runtime.

Example:
  agent-device react-devtools status
  agent-device react-devtools wait --connected
  agent-device react-devtools profile start
  agent-device fill 'id="catalog-search"' "tart" --delay-ms 80
  agent-device react-devtools profile stop
  agent-device react-devtools profile slow --limit 5
  agent-device react-devtools profile rerenders --limit 5
  agent-device react-devtools profile report @c5

Use snapshot, screenshot, logs, network, and perf for device/app runtime evidence. Use react-devtools only when component internals or React rendering behavior matters.`,
  },
  remote: {
    summary: 'Remote config, tenant, lease, and remote host flow',
    body: `agent-device help remote

Use remote config when a profile owns daemon URL, auth, tenant, run, lease, device scope, and Metro hints. Do not restate those as individual flags unless overriding intentionally.

Normal flow:
  agent-device connect --remote-config ./remote-config.json
  agent-device open com.example.app
  agent-device snapshot
  agent-device disconnect

Script flow, per-command config:
  agent-device open com.example.app --remote-config ./remote-config.json
  agent-device snapshot --remote-config ./remote-config.json
  agent-device disconnect --remote-config ./remote-config.json

Rules:
  connect and disconnect are top-level commands. Do not write agent-device remote connect or agent-device remote disconnect.
  Prefer --remote-config over --daemon-base-url, --tenant, --run-id, and --lease-id in ordinary remote flows.
  For self-contained scripts, pass the same --remote-config to every operational command, including disconnect; a preceding connect is optional but not required.
  For remote artifact installs, use install-from-source <url> or install-from-source --github-actions-artifact org/repo:artifact; do not download CI artifacts locally first.
  After connect, let the active remote connection supply runtime hints.
  For remote Android React DevTools, run agent-device react-devtools normally. The CLI opens the needed local service tunnel for the DevTools daemon and cleans it up when the command exits.
  Use --debug when remote connection or transport errors need diagnostic ids and remote log hints.`,
  },
  macos: {
    summary: 'macOS desktop, frontmost-app, and menu bar surfaces',
    body: `agent-device help macos

Use macOS only when the task targets desktop apps, desktop surfaces, or menu bar extras.

Open and inspect:
  agent-device open TextEdit --platform macos
  agent-device snapshot -i --platform macos

Surfaces:
  --surface app            normal app session
  --surface frontmost-app  inspect whichever app is frontmost
  --surface desktop        desktop-wide surface
  --surface menubar        menu bar extras and menu bar-only apps

Menu bar app example:
  agent-device open "Agent Device Tester Menu" --platform macos --surface menubar
  agent-device snapshot -i --platform macos --surface menubar

Context menu example:
  agent-device click @e66 --button secondary --platform macos
  agent-device snapshot -i --platform macos

Rules:
  Use open and snapshot -i for menu bar inspection. Do not output inspect as a command.
  Context menus are not ambient UI: secondary-click a visible target, then re-snapshot and use the new menu-item refs.
  Do not let iOS simulator-set scoping hide macOS desktop targets.
  Prefer refs/selectors over raw coordinates.
  macOS snapshot rects are window-space; use current refs or overlay refs instead of guessing coordinates.`,
  },
  dogfood: {
    summary: 'Exploratory QA workflow with reproducible evidence',
    body: `agent-device help dogfood

Use this when asked to dogfood, exploratory test, bug hunt, QA, or find issues in an app.

Goal:
  Find user-visible issues from runtime behavior. Do not read app source or invent findings from code.
  Produce a concise report with severity, repro commands, expected/actual behavior, and evidence paths.

Loop:
  1. Identify target app/platform; ask only if missing.
  2. Create output dirs and open a named session. If auth or OTP is required, sign in or ask the user for the code.
  3. Capture baseline snapshot -i and screenshot.
  4. Map top-level navigation, then exercise primary flows and edge states.
  5. For each issue, capture evidence and write the finding immediately, then continue.
  6. Close the session and reconcile the report summary.
  Keep stateful commands serial within the same session. Parallel runs can pollute text fields, focus, alerts, and navigation state.

Coverage:
  Navigation, forms, empty/error/loading states, offline or retry behavior, permissions, settings, accessibility labels, orientation/keyboard, and obvious performance stalls.
  React Native warning/error overlays can be real findings or test blockers. Capture them, dismiss if unrelated, re-snapshot, and report them.
  Expo Go/dev-client shells: use the provided exp:// or dev-client URL and record whether the shell, project load, or app UI is being tested. On iOS dogfood, prefer agent-device open "Expo Go" <url> when Expo Go is the known shell, then snapshot -i to confirm the project UI rather than the runner splash.
  Categories: visual, functional, UX, content, performance, diagnostics, permissions, accessibility.
  Severity: critical blocks a core flow/data/crashes; high breaks a major feature; medium has friction or workaround; low is polish.

Evidence commands:
  mkdir -p ./dogfood-output/screenshots ./dogfood-output/videos ./dogfood-output/traces
  agent-device --session qa open <app> --platform ios
  agent-device --session qa snapshot -i
  agent-device --session qa screenshot ./dogfood-output/screenshots/initial.png
  agent-device --session qa screenshot ./dogfood-output/screenshots/issue-001.png --overlay-refs
  agent-device --session qa logs clear --restart
  agent-device --session qa logs mark "issue-001 repro"
  agent-device --session qa logs path
  agent-device --session qa record start ./dogfood-output/videos/issue-001.mp4
  agent-device --session qa record stop
  agent-device --session qa close

Evidence rules:
  Interactive/behavioral issues need step screenshots and usually a repro video.
  Static/on-load issues can use one screenshot; set repro video to N/A.
  Use screenshot --overlay-refs when showing the tappable target or broken state helps repro.

Report shape:
  ./dogfood-output/report.md
  Include date, platform, target app, session, scope, severity counts, and issues.
  For each finding: ID, severity, category, title, affected flow/screen, repro commands, expected, actual, evidence files, notes.
  Target 5-10 well-evidenced issues when available. If no issues are found, report coverage completed and residual risk instead of claiming the app is bug-free.

Rules:
  Findings must come from observed runtime behavior, not source reads.
  Re-snapshot after each mutation.
  Keep commands in the report reproducible; use selectors or refs from fresh snapshots, not guessed coordinates.
  Prefer refs for exploration and selectors for deterministic replay.
  Use logs, network, screenshot --overlay-refs, trace, perf, or react-devtools only when they add evidence to a specific issue.
  Never delete screenshots, videos, traces, or report artifacts during a session.
  Escalate to help debugging or help react-devtools when runtime symptoms require those tools.`,
  },
} as const satisfies Record<string, { summary: string; body: string }>;

const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: 'config',
    names: ['--config'],
    type: 'string',
    usageLabel: '--config <path>',
    usageDescription: 'Load CLI defaults from a specific config file',
  },
  {
    key: 'remoteConfig',
    names: ['--remote-config'],
    type: 'string',
    usageLabel: '--remote-config <path>',
    usageDescription: 'Load remote host + Metro workflow settings from a specific profile file',
  },
  {
    key: 'stateDir',
    names: ['--state-dir'],
    type: 'string',
    usageLabel: '--state-dir <path>',
    usageDescription: 'Daemon state directory (defaults to ~/.agent-device)',
  },
  {
    key: 'daemonBaseUrl',
    names: ['--daemon-base-url'],
    type: 'string',
    usageLabel: '--daemon-base-url <url>',
    usageDescription: 'Explicit remote HTTP daemon base URL (skip local daemon discovery/startup)',
  },
  {
    key: 'daemonAuthToken',
    names: ['--daemon-auth-token'],
    type: 'string',
    usageLabel: '--daemon-auth-token <token>',
    usageDescription: 'Remote HTTP daemon auth token (sent as request token and bearer header)',
  },
  {
    key: 'daemonTransport',
    names: ['--daemon-transport'],
    type: 'enum',
    enumValues: ['auto', 'socket', 'http'],
    usageLabel: '--daemon-transport auto|socket|http',
    usageDescription: 'Daemon client transport preference',
  },
  {
    key: 'daemonServerMode',
    names: ['--daemon-server-mode'],
    type: 'enum',
    enumValues: ['socket', 'http', 'dual'],
    usageLabel: '--daemon-server-mode socket|http|dual',
    usageDescription: 'Daemon server mode used when spawning daemon',
  },
  {
    key: 'tenant',
    names: ['--tenant'],
    type: 'string',
    usageLabel: '--tenant <id>',
    usageDescription: 'Tenant scope identifier for isolated daemon sessions',
  },
  {
    key: 'sessionIsolation',
    names: ['--session-isolation'],
    type: 'enum',
    enumValues: ['none', 'tenant'],
    usageLabel: '--session-isolation none|tenant',
    usageDescription: 'Session isolation strategy (tenant prefixes session namespace)',
  },
  {
    key: 'runId',
    names: ['--run-id'],
    type: 'string',
    usageLabel: '--run-id <id>',
    usageDescription: 'Run identifier used for tenant lease admission checks',
  },
  {
    key: 'leaseId',
    names: ['--lease-id'],
    type: 'string',
    usageLabel: '--lease-id <id>',
    usageDescription: 'Lease identifier bound to tenant/run admission scope',
  },
  {
    key: 'leaseBackend',
    names: ['--lease-backend'],
    type: 'enum',
    enumValues: ['ios-simulator', 'ios-instance', 'android-instance'],
    usageLabel: '--lease-backend ios-simulator|ios-instance|android-instance',
    usageDescription: 'Lease backend for remote tenant connection admission',
  },
  {
    key: 'force',
    names: ['--force'],
    type: 'boolean',
    usageLabel: '--force',
    usageDescription: 'Force connection state replacement when reconnecting',
  },
  {
    key: 'noLogin',
    names: ['--no-login'],
    type: 'boolean',
    usageLabel: '--no-login',
    usageDescription: 'Connect: fail instead of starting implicit cloud login',
  },
  {
    key: 'sessionLock',
    names: ['--session-lock'],
    type: 'enum',
    enumValues: ['reject', 'strip'],
    usageLabel: '--session-lock reject|strip',
    usageDescription:
      'Lock bound-session device routing for this CLI invocation and nested batch steps',
  },
  {
    key: 'sessionLocked',
    names: ['--session-locked'],
    type: 'boolean',
    usageLabel: '--session-locked',
    usageDescription: 'Deprecated alias for --session-lock reject',
  },
  {
    key: 'sessionLockConflicts',
    names: ['--session-lock-conflicts'],
    type: 'enum',
    enumValues: ['reject', 'strip'],
    usageLabel: '--session-lock-conflicts reject|strip',
    usageDescription: 'Deprecated alias for --session-lock',
  },
  {
    key: 'platform',
    names: ['--platform'],
    type: 'enum',
    enumValues: ['ios', 'macos', 'android', 'linux', 'apple'],
    usageLabel: '--platform ios|macos|android|linux|apple',
    usageDescription: 'Platform to target (`apple` aliases the Apple automation backend)',
  },
  {
    key: 'target',
    names: ['--target'],
    type: 'enum',
    enumValues: ['mobile', 'tv', 'desktop'],
    usageLabel: '--target mobile|tv|desktop',
    usageDescription: 'Device target class to match',
  },
  {
    key: 'device',
    names: ['--device'],
    type: 'string',
    usageLabel: '--device <name>',
    usageDescription: 'Device name to target',
  },
  {
    key: 'udid',
    names: ['--udid'],
    type: 'string',
    usageLabel: '--udid <udid>',
    usageDescription: 'iOS device UDID',
  },
  {
    key: 'serial',
    names: ['--serial'],
    type: 'string',
    usageLabel: '--serial <serial>',
    usageDescription: 'Android device serial',
  },
  {
    key: 'surface',
    names: ['--surface'],
    type: 'enum',
    enumValues: SESSION_SURFACES,
    usageLabel: '--surface app|frontmost-app|desktop|menubar',
    usageDescription: 'macOS session surface for open (defaults to app)',
  },
  {
    key: 'headless',
    names: ['--headless'],
    type: 'boolean',
    usageLabel: '--headless',
    usageDescription: 'Boot: launch Android emulator without a GUI window',
  },
  {
    key: 'runtime',
    names: ['--runtime'],
    type: 'string',
    usageLabel: '--runtime <id>',
    usageDescription:
      'ensure-simulator: CoreSimulator runtime identifier (e.g. com.apple.CoreSimulator.SimRuntime.iOS-18-0)',
  },
  {
    key: 'metroHost',
    names: ['--metro-host'],
    type: 'string',
    usageLabel: '--metro-host <host>',
    usageDescription: 'Session-scoped Metro/debug host hint',
  },
  {
    key: 'metroPort',
    names: ['--metro-port'],
    type: 'int',
    min: 1,
    max: 65535,
    usageLabel: '--metro-port <port>',
    usageDescription: 'Session-scoped Metro/debug port hint',
  },
  {
    key: 'metroProjectRoot',
    names: ['--project-root'],
    type: 'string',
    usageLabel: '--project-root <path>',
    usageDescription: 'metro prepare: React Native project root (default: cwd)',
  },
  {
    key: 'metroKind',
    names: ['--kind'],
    type: 'enum',
    enumValues: ['auto', 'react-native', 'expo'],
    usageLabel: '--kind auto|react-native|expo',
    usageDescription: 'metro prepare: detect or force the Metro launcher kind',
  },
  {
    key: 'metroPublicBaseUrl',
    names: ['--public-base-url'],
    type: 'string',
    usageLabel: '--public-base-url <url>',
    usageDescription: 'metro prepare: public base URL used for direct bundle hints',
  },
  {
    key: 'metroProxyBaseUrl',
    names: ['--proxy-base-url'],
    type: 'string',
    usageLabel: '--proxy-base-url <url>',
    usageDescription: 'metro prepare: optional bridge origin for remote Metro access',
  },
  {
    key: 'metroBearerToken',
    names: ['--bearer-token'],
    type: 'string',
    usageLabel: '--bearer-token <token>',
    usageDescription:
      'metro prepare: host bridge bearer token (prefer AGENT_DEVICE_PROXY_TOKEN or AGENT_DEVICE_METRO_BEARER_TOKEN)',
  },
  {
    key: 'metroPreparePort',
    names: ['--port'],
    type: 'int',
    min: 1,
    max: 65535,
    usageLabel: '--port <port>',
    usageDescription: 'metro prepare: local Metro port (default: 8081)',
  },
  {
    key: 'metroListenHost',
    names: ['--listen-host'],
    type: 'string',
    usageLabel: '--listen-host <host>',
    usageDescription: 'metro prepare: host Metro listens on (default: 0.0.0.0)',
  },
  {
    key: 'metroStatusHost',
    names: ['--status-host'],
    type: 'string',
    usageLabel: '--status-host <host>',
    usageDescription: 'metro prepare: host used for local /status polling (default: 127.0.0.1)',
  },
  {
    key: 'metroStartupTimeoutMs',
    names: ['--startup-timeout-ms'],
    type: 'int',
    min: 1,
    usageLabel: '--startup-timeout-ms <ms>',
    usageDescription: 'metro prepare: timeout while waiting for Metro to become ready',
  },
  {
    key: 'metroProbeTimeoutMs',
    names: ['--probe-timeout-ms'],
    type: 'int',
    min: 1,
    usageLabel: '--probe-timeout-ms <ms>',
    usageDescription: 'metro prepare: timeout for /status and proxy bridge calls',
  },
  {
    key: 'metroRuntimeFile',
    names: ['--runtime-file'],
    type: 'string',
    usageLabel: '--runtime-file <path>',
    usageDescription: 'metro prepare: optional file path to persist the JSON result',
  },
  {
    key: 'metroNoReuseExisting',
    names: ['--no-reuse-existing'],
    type: 'boolean',
    usageLabel: '--no-reuse-existing',
    usageDescription: 'metro prepare: always start a fresh Metro process',
  },
  {
    key: 'metroNoInstallDeps',
    names: ['--no-install-deps'],
    type: 'boolean',
    usageLabel: '--no-install-deps',
    usageDescription: 'metro prepare: skip package-manager install when node_modules is missing',
  },
  {
    key: 'bundleUrl',
    names: ['--bundle-url'],
    type: 'string',
    usageLabel: '--bundle-url <url>',
    usageDescription: 'Session-scoped bundle URL hint',
  },
  {
    key: 'launchUrl',
    names: ['--launch-url'],
    type: 'string',
    usageLabel: '--launch-url <url>',
    usageDescription: 'Session-scoped deep link / launch URL hint',
  },
  {
    key: 'boot',
    names: ['--boot'],
    type: 'boolean',
    usageLabel: '--boot',
    usageDescription: 'ensure-simulator: boot the simulator after ensuring it exists',
  },
  {
    key: 'reuseExisting',
    names: ['--reuse-existing'],
    type: 'boolean',
    usageLabel: '--reuse-existing',
    usageDescription: 'ensure-simulator: reuse an existing simulator (default: true)',
  },
  {
    key: 'iosSimulatorDeviceSet',
    names: ['--ios-simulator-device-set'],
    type: 'string',
    usageLabel: '--ios-simulator-device-set <path>',
    usageDescription: 'Scope iOS simulator discovery/commands to this simulator device set',
  },
  {
    key: 'androidDeviceAllowlist',
    names: ['--android-device-allowlist'],
    type: 'string',
    usageLabel: '--android-device-allowlist <serials>',
    usageDescription: 'Comma/space separated Android serial allowlist for discovery/selection',
  },
  {
    key: 'activity',
    names: ['--activity'],
    type: 'string',
    usageLabel: '--activity <component>',
    usageDescription: 'Android app launch activity (package/Activity); not for URL opens',
  },
  {
    key: 'header',
    names: ['--header'],
    type: 'string',
    multiple: true,
    usageLabel: '--header <name:value>',
    usageDescription: 'install-from-source: repeatable HTTP header for URL downloads',
  },
  {
    key: 'githubActionsArtifact',
    names: ['--github-actions-artifact'],
    type: 'string',
    usageLabel: '--github-actions-artifact <owner/repo:artifact>',
    usageDescription: 'install-from-source: GitHub Actions artifact resolved by a remote daemon',
  },
  {
    key: 'installSource',
    // Config-only virtual option; parsed explicitly from JSON before generic string options.
    names: [],
    type: 'string',
  },
  {
    key: 'session',
    names: ['--session'],
    type: 'string',
    usageLabel: '--session <name>',
    usageDescription: 'Named session',
  },
  {
    key: 'count',
    names: ['--count'],
    type: 'int',
    min: 1,
    max: 200,
    usageLabel: '--count <n>',
    usageDescription: 'Repeat count for press/swipe series',
  },
  {
    key: 'fps',
    names: ['--fps'],
    type: 'int',
    min: 1,
    max: 120,
    usageLabel: '--fps <n>',
    usageDescription: 'Record: target frames per second (iOS physical device runner)',
  },
  {
    key: 'quality',
    names: ['--quality'],
    type: 'int',
    min: 5,
    max: 10,
    usageLabel: '--quality <5-10>',
    usageDescription:
      'Record: scale recording resolution from 5 (50%) through 10 (native resolution)',
  },
  {
    key: 'hideTouches',
    names: ['--hide-touches'],
    type: 'boolean',
    usageLabel: '--hide-touches',
    usageDescription: 'Record: disable touch overlays in the final video',
  },
  {
    key: 'intervalMs',
    names: ['--interval-ms'],
    type: 'int',
    min: 0,
    max: 10_000,
    usageLabel: '--interval-ms <ms>',
    usageDescription: 'Delay between press iterations',
  },
  {
    key: 'delayMs',
    names: ['--delay-ms'],
    type: 'int',
    min: 0,
    max: 10_000,
    usageLabel: '--delay-ms <ms>',
    usageDescription: 'Delay between typed characters',
  },
  {
    key: 'holdMs',
    names: ['--hold-ms'],
    type: 'int',
    min: 0,
    max: 10_000,
    usageLabel: '--hold-ms <ms>',
    usageDescription: 'Press hold duration for each iteration',
  },
  {
    key: 'jitterPx',
    names: ['--jitter-px'],
    type: 'int',
    min: 0,
    max: 100,
    usageLabel: '--jitter-px <n>',
    usageDescription: 'Deterministic coordinate jitter radius for press',
  },
  {
    key: 'pixels',
    names: ['--pixels'],
    type: 'int',
    min: 1,
    max: 100_000,
    usageLabel: '--pixels <n>',
    usageDescription: 'Scroll: explicit gesture distance in pixels',
  },
  {
    key: 'doubleTap',
    names: ['--double-tap'],
    type: 'boolean',
    usageLabel: '--double-tap',
    usageDescription: 'Use double-tap gesture per press iteration',
  },
  {
    key: 'clickButton',
    names: ['--button'],
    type: 'enum',
    enumValues: ['primary', 'secondary', 'middle'],
    usageLabel: '--button primary|secondary|middle',
    usageDescription: 'Click: choose mouse button (middle reserved for future macOS support)',
  },
  // These aliases encode the value directly in the flag name so `back` reads naturally as
  // `back --in-app` or `back --system` without introducing a separate `--back-mode` flag.
  {
    key: 'backMode',
    names: ['--in-app'],
    type: 'enum',
    enumValues: ['in-app', 'system'],
    setValue: 'in-app',
    usageLabel: '--in-app',
    usageDescription: 'Back: use app-provided back UI when available',
  },
  {
    key: 'backMode',
    names: ['--system'],
    type: 'enum',
    enumValues: ['in-app', 'system'],
    setValue: 'system',
    usageLabel: '--system',
    usageDescription: 'Back: use system back input or gesture when available',
  },
  {
    key: 'pauseMs',
    names: ['--pause-ms'],
    type: 'int',
    min: 0,
    max: 10_000,
    usageLabel: '--pause-ms <ms>',
    usageDescription: 'Delay between swipe iterations',
  },
  {
    key: 'pattern',
    names: ['--pattern'],
    type: 'enum',
    enumValues: ['one-way', 'ping-pong'],
    usageLabel: '--pattern one-way|ping-pong',
    usageDescription: 'Swipe repeat pattern',
  },
  {
    key: 'verbose',
    names: ['--debug', '--verbose', '-v'],
    type: 'boolean',
    usageLabel: '--debug, --verbose, -v',
    usageDescription: 'Enable debug diagnostics and stream daemon/runner logs',
  },
  {
    key: 'json',
    names: ['--json'],
    type: 'boolean',
    usageLabel: '--json',
    usageDescription: 'JSON output',
  },
  {
    key: 'help',
    names: ['--help', '-h'],
    type: 'boolean',
    usageLabel: '--help, -h',
    usageDescription: 'Print help and exit',
  },
  {
    key: 'version',
    names: ['--version', '-V'],
    type: 'boolean',
    usageLabel: '--version, -V',
    usageDescription: 'Print version and exit',
  },
  {
    key: 'snapshotDiff',
    names: ['--diff'],
    type: 'boolean',
    usageLabel: '--diff',
    usageDescription: 'Snapshot: show structural diff against the previous session baseline',
  },
  {
    key: 'saveScript',
    names: ['--save-script'],
    type: 'booleanOrString',
    usageLabel: '--save-script [path]',
    usageDescription: 'Save session script (.ad) on close; optional custom output path',
  },
  {
    key: 'networkInclude',
    names: ['--include'],
    type: 'enum',
    enumValues: ['summary', 'headers', 'body', 'all'],
    usageLabel: '--include summary|headers|body|all',
    usageDescription: 'Network: include headers, bodies, or both in output',
  },
  {
    key: 'shutdown',
    names: ['--shutdown'],
    type: 'boolean',
    usageLabel: '--shutdown',
    usageDescription: 'close: shutdown associated iOS simulator after ending session',
  },
  {
    key: 'relaunch',
    names: ['--relaunch'],
    type: 'boolean',
    usageLabel: '--relaunch',
    usageDescription: 'open: terminate app process before launching it',
  },
  {
    key: 'restart',
    names: ['--restart'],
    type: 'boolean',
    usageLabel: '--restart',
    usageDescription: 'logs clear: stop active stream, clear logs, then start streaming again',
  },
  {
    key: 'retainPaths',
    names: ['--retain-paths'],
    type: 'boolean',
    usageLabel: '--retain-paths',
    usageDescription: 'install-from-source: keep materialized artifact paths after install',
  },
  {
    key: 'retentionMs',
    names: ['--retention-ms'],
    type: 'int',
    min: 1,
    usageLabel: '--retention-ms <ms>',
    usageDescription: 'install-from-source: retention TTL for materialized artifact paths',
  },
  {
    key: 'noRecord',
    names: ['--no-record'],
    type: 'boolean',
    usageLabel: '--no-record',
    usageDescription: 'Do not record this action',
  },
  {
    key: 'replayUpdate',
    names: ['--update', '-u'],
    type: 'boolean',
    usageLabel: '--update, -u',
    usageDescription: 'Replay: update selectors and rewrite replay file in place',
  },
  {
    key: 'replayEnv',
    names: ['-e', '--env'],
    type: 'string',
    multiple: true,
    usageLabel: '-e KEY=VALUE, --env KEY=VALUE',
    usageDescription:
      'Replay/Test: inject or override a ${KEY} variable for the script (repeatable)',
  },
  {
    key: 'failFast',
    names: ['--fail-fast'],
    type: 'boolean',
    usageLabel: '--fail-fast',
    usageDescription: 'Test: stop the suite after the first failing script',
  },
  {
    key: 'timeoutMs',
    names: ['--timeout'],
    type: 'int',
    min: 1,
    usageLabel: '--timeout <ms>',
    usageDescription: 'Test: maximum wall-clock time per script attempt',
  },
  {
    key: 'retries',
    names: ['--retries'],
    type: 'int',
    min: 0,
    max: 3,
    usageLabel: '--retries <n>',
    usageDescription: 'Test: retry each failed script up to n additional times',
  },
  {
    key: 'artifactsDir',
    names: ['--artifacts-dir'],
    type: 'string',
    usageLabel: '--artifacts-dir <path>',
    usageDescription: 'Test: root directory for suite artifacts',
  },
  {
    key: 'reportJunit',
    names: ['--report-junit'],
    type: 'string',
    usageLabel: '--report-junit <path>',
    usageDescription: 'Test: write a JUnit XML report for the replay suite',
  },
  {
    key: 'steps',
    names: ['--steps'],
    type: 'string',
    usageLabel: '--steps <json>',
    usageDescription: 'Batch: JSON array of steps',
  },
  {
    key: 'stepsFile',
    names: ['--steps-file'],
    type: 'string',
    usageLabel: '--steps-file <path>',
    usageDescription: 'Batch: read steps JSON from file',
  },
  {
    key: 'batchOnError',
    names: ['--on-error'],
    type: 'enum',
    enumValues: ['stop'],
    usageLabel: '--on-error stop',
    usageDescription: 'Batch: stop when a step fails',
  },
  {
    key: 'batchMaxSteps',
    names: ['--max-steps'],
    type: 'int',
    min: 1,
    max: 1000,
    usageLabel: '--max-steps <n>',
    usageDescription: 'Batch: maximum number of allowed steps',
  },
  {
    key: 'appsFilter',
    names: ['--user-installed'],
    type: 'enum',
    setValue: 'user-installed',
    usageLabel: '--user-installed',
    usageDescription: 'Apps: list user-installed apps',
  },
  {
    key: 'appsFilter',
    names: ['--all'],
    type: 'enum',
    setValue: 'all',
    usageLabel: '--all',
    usageDescription: 'Apps: list all apps (include system/default apps)',
  },
  {
    key: 'snapshotInteractiveOnly',
    names: ['-i'],
    type: 'boolean',
    usageLabel: '-i',
    usageDescription: 'Snapshot: interactive elements only',
  },
  {
    key: 'snapshotCompact',
    names: ['-c'],
    type: 'boolean',
    usageLabel: '-c',
    usageDescription: 'Snapshot: compact output (drop empty structure)',
  },
  {
    key: 'snapshotDepth',
    names: ['--depth', '-d'],
    type: 'int',
    min: 0,
    usageLabel: '--depth, -d <depth>',
    usageDescription: 'Snapshot: limit snapshot depth',
  },
  {
    key: 'snapshotScope',
    names: ['--scope', '-s'],
    type: 'string',
    usageLabel: '--scope, -s <scope>',
    usageDescription: 'Snapshot: scope snapshot to label/identifier',
  },
  {
    key: 'snapshotRaw',
    names: ['--raw'],
    type: 'boolean',
    usageLabel: '--raw',
    usageDescription: 'Snapshot: raw node output',
  },
  {
    key: 'findFirst',
    names: ['--first'],
    type: 'boolean',
    usageLabel: '--first',
    usageDescription: 'Find: pick the first match when ambiguous',
  },
  {
    key: 'findLast',
    names: ['--last'],
    type: 'boolean',
    usageLabel: '--last',
    usageDescription: 'Find: pick the last match when ambiguous',
  },
  {
    key: 'out',
    names: ['--out'],
    type: 'string',
    usageLabel: '--out <path>',
    usageDescription: 'Output path',
  },
  {
    key: 'overlayRefs',
    names: ['--overlay-refs'],
    type: 'boolean',
    usageLabel: '--overlay-refs',
    usageDescription:
      'Screenshot: draw current snapshot refs and target rectangles onto the saved PNG; diff screenshot: also write a separate current-screen overlay guide',
  },
  {
    key: 'screenshotFullscreen',
    names: ['--fullscreen'],
    type: 'boolean',
    usageLabel: '--fullscreen',
    usageDescription: 'Screenshot: capture the full screen instead of the app window',
  },
  {
    key: 'screenshotMaxSize',
    names: ['--max-size'],
    type: 'int',
    min: 1,
    usageLabel: '--max-size <px>',
    usageDescription: 'Screenshot: downscale so the longest edge is at most <px>',
  },
  {
    key: 'baseline',
    names: ['--baseline', '-b'],
    type: 'string',
    usageLabel: '--baseline, -b <path>',
    usageDescription: 'Diff screenshot: path to baseline image file',
  },
  {
    key: 'threshold',
    names: ['--threshold'],
    type: 'string',
    usageLabel: '--threshold <0-1>',
    usageDescription: 'Diff screenshot: color distance threshold (default 0.1)',
  },
];

export const GLOBAL_FLAG_KEYS = new Set<FlagKey>([
  'json',
  'config',
  'remoteConfig',
  'stateDir',
  'daemonBaseUrl',
  'daemonAuthToken',
  'daemonTransport',
  'daemonServerMode',
  'tenant',
  'sessionIsolation',
  'runId',
  'leaseId',
  'leaseBackend',
  'sessionLock',
  'sessionLocked',
  'sessionLockConflicts',
  'help',
  'version',
  'verbose',
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'iosSimulatorDeviceSet',
  'androidDeviceAllowlist',
  'session',
  'noRecord',
]);

const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
  boot: {
    helpDescription: 'Ensure target device/simulator is booted and ready',
    summary: 'Boot target device/simulator',
    positionalArgs: [],
    allowedFlags: ['headless'],
  },
  open: {
    helpDescription:
      'Boot device/simulator; optionally launch app or deep link URL (macOS also supports --surface app|frontmost-app|desktop|menubar)',
    summary: 'Open an app, deep link or URL, save replays',
    positionalArgs: ['appOrUrl?', 'url?'],
    allowedFlags: ['activity', 'saveScript', 'relaunch', 'surface'],
  },
  connect: {
    usageOverride:
      'connect --remote-config <path> [--tenant <id>] [--run-id <id>] [--lease-backend <backend>] [--force] [--no-login]',
    helpDescription:
      'Connect to a remote daemon, authenticate when needed, and save remote session state. AGENT_DEVICE_CLOUD_BASE_URL is the bridge/control-plane API origin; use AGENT_DEVICE_DAEMON_AUTH_TOKEN=adc_live_... for CI/service-token automation.',
    summary: 'Connect to remote daemon',
    positionalArgs: [],
    allowedFlags: [
      'force',
      'noLogin',
      'metroProjectRoot',
      'metroKind',
      'metroPublicBaseUrl',
      'metroProxyBaseUrl',
      'metroBearerToken',
      'metroPreparePort',
      'metroListenHost',
      'metroStatusHost',
      'metroStartupTimeoutMs',
      'metroProbeTimeoutMs',
      'metroRuntimeFile',
      'metroNoReuseExisting',
      'metroNoInstallDeps',
      'launchUrl',
    ],
    skipCapabilityCheck: true,
  },
  disconnect: {
    helpDescription:
      'Disconnect remote daemon state, stop owned Metro companion, and release lease',
    summary: 'Disconnect remote daemon',
    positionalArgs: [],
    allowedFlags: ['shutdown'],
    skipCapabilityCheck: true,
  },
  connection: {
    usageOverride: 'connection status',
    listUsageOverride: 'connection status',
    helpDescription: 'Inspect active remote connection state',
    summary: 'Inspect remote connection',
    positionalArgs: ['status'],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  auth: {
    usageOverride: 'auth status|login|logout',
    listUsageOverride: 'auth status|login|logout',
    helpDescription: 'Manage cloud CLI authentication',
    summary: 'Manage cloud authentication',
    positionalArgs: ['status|login|logout'],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  close: {
    helpDescription: 'Close app or just end session',
    summary: 'Close app or end session',
    positionalArgs: ['app?'],
    allowedFlags: ['saveScript', 'shutdown'],
  },
  reinstall: {
    helpDescription: 'Uninstall + install app from binary path',
    summary: 'Reinstall app from binary path',
    positionalArgs: ['app', 'path'],
    allowedFlags: [],
  },
  install: {
    helpDescription: 'Install app from binary path without uninstalling first',
    summary: 'Install app from binary path',
    positionalArgs: ['app', 'path'],
    allowedFlags: [],
  },
  'install-from-source': {
    usageOverride:
      'install-from-source <url> | install-from-source --github-actions-artifact <owner/repo:artifact>',
    listUsageOverride: 'install-from-source <url> | install-from-source --github-actions-artifact',
    helpDescription: 'Install app from a URL or remote-resolved source',
    summary: 'Install app from a source',
    positionalArgs: ['url?'],
    allowedFlags: [
      'header',
      'githubActionsArtifact',
      'installSource',
      'retainPaths',
      'retentionMs',
    ],
  },
  push: {
    helpDescription: 'Simulate push notification payload delivery',
    summary: 'Deliver push payload',
    positionalArgs: ['bundleOrPackage', 'payloadOrJson'],
    allowedFlags: [],
  },
  snapshot: {
    usageOverride: 'snapshot [--diff] [-i] [-c] [-d <depth>] [-s <scope>] [--raw]',
    helpDescription: 'Capture accessibility tree or diff against the previous session baseline',
    positionalArgs: [],
    allowedFlags: ['snapshotDiff', ...SNAPSHOT_FLAGS],
  },
  diff: {
    usageOverride:
      'diff snapshot | diff screenshot --baseline <path> [current.png] [--out <diff.png>] [--threshold <0-1>] [--overlay-refs]',
    helpDescription: 'Diff accessibility snapshot or compare screenshots pixel-by-pixel',
    summary: 'Diff snapshot or screenshot',
    positionalArgs: ['kind', 'current?'],
    allowedFlags: [...SNAPSHOT_FLAGS, 'baseline', 'threshold', 'out', 'overlayRefs'],
  },
  'ensure-simulator': {
    helpDescription: 'Ensure an iOS simulator exists in a device set (create if missing)',
    summary: 'Ensure iOS simulator exists',
    positionalArgs: [],
    allowedFlags: ['runtime', 'boot', 'reuseExisting'],
    skipCapabilityCheck: true,
  },
  devices: {
    helpDescription: 'List available devices',
    positionalArgs: [],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  apps: {
    helpDescription: 'List installed apps (includes default/system apps by default)',
    summary: 'List installed apps',
    positionalArgs: [],
    allowedFlags: ['appsFilter'],
    defaults: { appsFilter: 'all' },
  },
  appstate: {
    helpDescription: 'Show foreground app/activity',
    positionalArgs: [],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  metro: {
    usageOverride:
      'metro prepare (--public-base-url <url> | --proxy-base-url <url>) [--project-root <path>] [--port <port>] [--kind auto|react-native|expo]\n  agent-device metro reload [--metro-host <host>] [--metro-port <port>] [--bundle-url <url>]',
    listUsageOverride:
      'metro prepare --public-base-url <url> | --proxy-base-url <url>; metro reload',
    helpDescription:
      'Prepare a local Metro runtime or ask Metro to reload connected React Native apps',
    summary: 'Prepare Metro or reload apps',
    positionalArgs: ['prepare|reload'],
    allowedFlags: [
      'metroHost',
      'metroPort',
      'metroProjectRoot',
      'metroKind',
      'metroPublicBaseUrl',
      'metroProxyBaseUrl',
      'metroBearerToken',
      'metroPreparePort',
      'metroListenHost',
      'metroStatusHost',
      'metroStartupTimeoutMs',
      'metroProbeTimeoutMs',
      'metroRuntimeFile',
      'metroNoReuseExisting',
      'metroNoInstallDeps',
      'bundleUrl',
    ],
    skipCapabilityCheck: true,
  },
  clipboard: {
    usageOverride: 'clipboard read | clipboard write <text>',
    listUsageOverride: 'clipboard read | clipboard write <text>',
    helpDescription: 'Read or write device clipboard text',
    positionalArgs: ['read|write', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [],
  },
  keyboard: {
    usageOverride: 'keyboard [status|get|dismiss]',
    helpDescription: 'Inspect Android keyboard visibility/type or dismiss the device keyboard',
    summary: 'Inspect or dismiss the device keyboard',
    positionalArgs: ['action?'],
    allowedFlags: [],
  },
  perf: {
    helpDescription:
      'Show session performance metrics, including frame health on Android and iOS devices',
    summary: 'Show performance metrics',
    positionalArgs: [],
    allowedFlags: [],
  },
  'react-devtools': {
    usageOverride: 'react-devtools [...args]',
    listUsageOverride: 'react-devtools [...args]',
    helpDescription:
      'Run pinned agent-react-devtools commands for React Native performance profiling, component trees, props/state/hooks, and render analysis',
    summary: 'Profile React Native performance and component renders',
    positionalArgs: ['args?'],
    allowsExtraPositionals: true,
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  back: {
    usageOverride: 'back [--in-app|--system]',
    helpDescription: 'Navigate back with explicit app or system semantics',
    summary: 'Go back',
    positionalArgs: [],
    allowedFlags: ['backMode'],
  },
  home: {
    helpDescription: 'Go to home screen (where supported)',
    summary: 'Go home',
    positionalArgs: [],
    allowedFlags: [],
  },
  rotate: {
    usageOverride: 'rotate <portrait|portrait-upside-down|landscape-left|landscape-right>',
    helpDescription: 'Rotate device orientation on iOS and Android',
    summary: 'Rotate device orientation',
    positionalArgs: ['orientation'],
    allowedFlags: [],
  },
  'app-switcher': {
    helpDescription: 'Open app switcher (where supported)',
    summary: 'Open app switcher',
    positionalArgs: [],
    allowedFlags: [],
  },
  wait: {
    usageOverride: 'wait <ms>|text <text>|@ref|<selector> [timeoutMs]',
    helpDescription: 'Wait for duration, text, ref, or selector to appear',
    summary: 'Wait for time, text, ref, or selector',
    positionalArgs: ['durationOrSelector', 'timeoutMs?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  alert: {
    usageOverride: 'alert [get|accept|dismiss|wait] [timeout]',
    helpDescription: 'Inspect or handle alert (iOS simulator and macOS desktop)',
    summary: 'Inspect or handle iOS/macOS alerts',
    positionalArgs: ['action?', 'timeout?'],
    allowedFlags: [],
  },
  click: {
    usageOverride: 'click <x y|@ref|selector>',
    helpDescription: 'Tap/click by coordinates, snapshot ref, or selector',
    summary: 'Tap by coordinates, ref, or selector',
    positionalArgs: ['target'],
    allowsExtraPositionals: true,
    allowedFlags: [
      'count',
      'intervalMs',
      'holdMs',
      'jitterPx',
      'doubleTap',
      'clickButton',
      ...SELECTOR_SNAPSHOT_FLAGS,
    ],
  },
  get: {
    usageOverride: 'get text|attrs <@ref|selector>',
    helpDescription:
      'Return exposed element text/attributes by ref or selector; use snapshot -s @ref for truncated previews',
    summary: 'Get exposed text or attrs by ref or selector',
    positionalArgs: ['subcommand', 'target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  replay: {
    helpDescription: 'Replay a recorded session',
    positionalArgs: ['path'],
    allowedFlags: ['replayUpdate', 'replayEnv'],
    skipCapabilityCheck: true,
  },
  test: {
    usageOverride: 'test <path-or-glob>...',
    listUsageOverride: 'test <path-or-glob>...',
    helpDescription: 'Run one or more .ad scripts as a serial test suite',
    summary: 'Run .ad test suites',
    positionalArgs: ['pathOrGlob'],
    allowsExtraPositionals: true,
    allowedFlags: [
      'replayUpdate',
      'replayEnv',
      'failFast',
      'timeoutMs',
      'retries',
      'artifactsDir',
      'reportJunit',
    ],
    skipCapabilityCheck: true,
  },
  batch: {
    usageOverride: 'batch [--steps <json> | --steps-file <path>]',
    listUsageOverride: 'batch --steps <json> | --steps-file <path>',
    helpDescription: 'Execute multiple commands in one daemon request',
    summary: 'Run multiple commands',
    positionalArgs: [],
    allowedFlags: ['steps', 'stepsFile', 'batchOnError', 'batchMaxSteps', 'out'],
    skipCapabilityCheck: true,
  },
  press: {
    usageOverride: 'press <x y|@ref|selector>',
    helpDescription:
      'Tap/press by coordinates, snapshot ref, or selector (supports repeated series)',
    summary: 'Press by coordinates, ref, or selector',
    positionalArgs: ['targetOrX', 'y?'],
    allowsExtraPositionals: true,
    allowedFlags: [
      'count',
      'intervalMs',
      'holdMs',
      'jitterPx',
      'doubleTap',
      ...SELECTOR_SNAPSHOT_FLAGS,
    ],
  },
  longpress: {
    helpDescription: 'Long press by coordinates (iOS and Android)',
    summary: 'Long press by coordinates',
    positionalArgs: ['x', 'y', 'durationMs?'],
    allowedFlags: [],
  },
  swipe: {
    helpDescription: 'Swipe coordinates with optional repeat pattern',
    summary: 'Swipe coordinates',
    positionalArgs: ['x1', 'y1', 'x2', 'y2', 'durationMs?'],
    allowedFlags: ['count', 'pauseMs', 'pattern'],
  },
  focus: {
    helpDescription: 'Focus input at coordinates',
    positionalArgs: ['x', 'y'],
    allowedFlags: [],
  },
  type: {
    helpDescription: 'Type text in focused field',
    positionalArgs: ['text'],
    allowsExtraPositionals: true,
    allowedFlags: ['delayMs'],
  },
  fill: {
    usageOverride: 'fill <x> <y> <text> | fill <@ref|selector> <text>',
    helpDescription: 'Tap then type',
    positionalArgs: ['targetOrX', 'yOrText', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS, 'delayMs'],
  },
  scroll: {
    usageOverride: 'scroll <direction> [amount] [--pixels <n>]',
    helpDescription: 'Scroll in direction (relative amount or explicit pixels)',
    summary: 'Scroll in a direction',
    positionalArgs: ['direction', 'amount?'],
    allowedFlags: ['pixels'],
  },
  pinch: {
    helpDescription: 'Pinch/zoom gesture (Apple simulator or macOS app session)',
    positionalArgs: ['scale', 'x?', 'y?'],
    allowedFlags: [],
  },
  screenshot: {
    helpDescription:
      'Capture screenshot (macOS app sessions default to the app window; use --fullscreen for full desktop, --max-size to downscale, or --overlay-refs to annotate the image with current refs)',
    positionalArgs: ['path?'],
    allowedFlags: ['out', 'overlayRefs', 'screenshotFullscreen', 'screenshotMaxSize'],
  },
  'trigger-app-event': {
    usageOverride: 'trigger-app-event <event> [payloadJson]',
    helpDescription: 'Trigger app-defined event hook via deep link template',
    summary: 'Trigger app event hook',
    positionalArgs: ['event', 'payloadJson?'],
    allowedFlags: [],
  },
  record: {
    usageOverride:
      'record start [path] [--fps <n>] [--quality <5-10>] [--hide-touches] | record stop',
    listUsageOverride: 'record start [path] | record stop',
    helpDescription: 'Start/stop screen recording',
    summary: 'Start or stop screen recording',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: ['fps', 'quality', 'hideTouches'],
  },
  trace: {
    usageOverride: 'trace start <path> | trace stop <path>',
    listUsageOverride: 'trace start <path> | trace stop <path>',
    helpDescription:
      'Start/stop trace log capture; when an artifact path is requested, pass the same positional path to start and stop',
    summary: 'Start or stop trace capture',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  logs: {
    usageOverride:
      'logs path | logs start | logs stop | logs clear [--restart] | logs doctor | logs mark [message...]',
    helpDescription: 'Session app log info, start/stop streaming, diagnostics, and markers',
    summary: 'Manage session app logs',
    positionalArgs: ['path|start|stop|clear|doctor|mark', 'message?'],
    allowsExtraPositionals: true,
    allowedFlags: ['restart'],
  },
  network: {
    usageOverride:
      'network dump [limit] [summary|headers|body|all] [--include summary|headers|body|all] | network log [limit] [summary|headers|body|all] [--include summary|headers|body|all]',
    helpDescription: 'Dump recent HTTP(s) traffic parsed from the session app log',
    summary: 'Show recent HTTP traffic',
    positionalArgs: ['dump|log', 'limit?', 'include?'],
    allowedFlags: ['networkInclude'],
  },
  find: {
    usageOverride: 'find <locator|text> <action> [value] [--first|--last]',
    helpDescription: 'Find by text/label/value/role/id and run action',
    summary: 'Find an element and act',
    positionalArgs: ['query', 'action', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...FIND_SNAPSHOT_FLAGS, 'findFirst', 'findLast'],
  },
  is: {
    helpDescription: 'Assert UI state (visible|hidden|exists|editable|selected|text)',
    summary: 'Assert UI state',
    positionalArgs: ['predicate', 'selector', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  settings: {
    usageOverride: SETTINGS_USAGE_OVERRIDE,
    listUsageOverride: 'settings [area] [options]',
    helpDescription:
      'Toggle OS settings, animation scales, appearance, and app permissions (macOS supports only settings appearance <light|dark|toggle> and settings permission <grant|reset> <accessibility|screen-recording|input-monitoring>; wifi|airplane|location|animations remain unsupported on macOS; mobile permission actions use the active session app)',
    summary: 'Change OS settings and app permissions',
    positionalArgs: ['setting', 'state', 'target?', 'mode?'],
    allowedFlags: [],
  },
  session: {
    usageOverride: 'session list',
    helpDescription: 'List active sessions',
    positionalArgs: ['list?'],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
};

const flagDefinitionByName = new Map<string, FlagDefinition>();
const flagDefinitionsByKey = new Map<FlagKey, FlagDefinition[]>();
for (const definition of FLAG_DEFINITIONS) {
  for (const name of definition.names) {
    flagDefinitionByName.set(name, definition);
  }
  const list = flagDefinitionsByKey.get(definition.key);
  if (list) list.push(definition);
  else flagDefinitionsByKey.set(definition.key, [definition]);
}

export function getFlagDefinition(token: string): FlagDefinition | undefined {
  return flagDefinitionByName.get(token);
}

export function getFlagDefinitions(): readonly FlagDefinition[] {
  return FLAG_DEFINITIONS;
}

export function getCommandSchema(command: string | null): CommandSchema | undefined {
  if (!command) return undefined;
  return COMMAND_SCHEMAS[command];
}

export function getCliCommandNames(): string[] {
  return Object.keys(COMMAND_SCHEMAS);
}

export function getSchemaCapabilityKeys(): string[] {
  return Object.entries(COMMAND_SCHEMAS)
    .filter(([, schema]) => !schema.skipCapabilityCheck)
    .map(([name]) => name)
    .sort();
}

export function isStrictFlagModeEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function formatPositionalArg(arg: string): string {
  const optional = arg.endsWith('?');
  const name = optional ? arg.slice(0, -1) : arg;
  return optional ? `[${name}]` : `<${name}>`;
}

function formatCommandListArg(commandName: string, schema: CommandSchema, arg: string): string {
  const optional = arg.endsWith('?');
  const name = optional ? arg.slice(0, -1) : arg;
  const isChoiceLiteral = /^[a-z-]+(?:\|[a-z-]+)+$/i.test(name);
  const isLiteralToken =
    isChoiceLiteral ||
    (schema.usageOverride !== undefined &&
      schema.usageOverride.startsWith(`${commandName} ${name}`));
  if (optional) {
    if (isChoiceLiteral) return `[${name}]`;
    if (isLiteralToken) return name;
    return `[${name}]`;
  }
  return isLiteralToken ? name : `<${name}>`;
}

function buildCommandUsage(commandName: string, schema: CommandSchema): string {
  if (schema.usageOverride) return schema.usageOverride;
  const positionals = schema.positionalArgs.map(formatPositionalArg);
  const flagLabels = schema.allowedFlags.flatMap((key) =>
    (flagDefinitionsByKey.get(key) ?? []).map(
      (definition) => definition.usageLabel ?? definition.names[0],
    ),
  );
  const optionalFlags = flagLabels.map((label) => `[${label}]`);
  return [commandName, ...positionals, ...optionalFlags].join(' ');
}

function buildCommandListUsage(commandName: string, schema: CommandSchema): string {
  if (schema.listUsageOverride) return schema.listUsageOverride;
  const positionals = schema.positionalArgs.map((arg) =>
    formatCommandListArg(commandName, schema, arg),
  );
  return [commandName, ...positionals].join(' ');
}

function renderUsageText(): string {
  const header = `agent-device <command> [args] [--json]

CLI to control iOS and Android devices for AI agents.
`;

  const commands = getCliCommandNames().map((name) => {
    const schema = COMMAND_SCHEMAS[name];
    if (!schema) throw new Error(`Missing command schema for ${name}`);
    return { name, schema, usage: buildCommandListUsage(name, schema) };
  });
  const commandLines = renderCommandSection(commands);

  const helpFlags = listHelpFlags(GLOBAL_FLAG_KEYS);
  const flagsSection = renderFlagSection('Flags:', helpFlags);
  const quickstartSection = renderTextSection('Agent Quickstart:', AGENT_QUICKSTART_LINES);
  const workflowsSection = renderAlignedSection('Agent Workflows:', AGENT_WORKFLOWS);
  const configSection = renderTextSection('Configuration:', CONFIGURATION_LINES);
  const environmentSection = renderAlignedSection('Environment:', ENVIRONMENT_LINES);
  const examplesSection = renderTextSection('Examples:', EXAMPLE_LINES);

  return `${header}
${commandLines}

${flagsSection}

${quickstartSection}

${workflowsSection}

${configSection}

${environmentSection}

${examplesSection}
`;
}

const USAGE_TEXT = renderUsageText();

export function buildUsageText(): string {
  return USAGE_TEXT;
}

function listHelpFlags(keys: ReadonlySet<FlagKey>): FlagDefinition[] {
  return FLAG_DEFINITIONS.filter(
    (definition) =>
      keys.has(definition.key) &&
      definition.usageLabel !== undefined &&
      definition.usageDescription !== undefined,
  );
}

function renderFlagSection(title: string, definitions: FlagDefinition[]): string {
  return renderAlignedSection(
    title,
    definitions.map((flag) => ({
      label: flag.usageLabel ?? '',
      description: flag.usageDescription ?? '',
    })),
  );
}

function renderAlignedSection(
  title: string,
  items: ReadonlyArray<{ label: string; description: string }>,
): string {
  if (items.length === 0) {
    return `${title}\n  (none)`;
  }
  const maxLabelLength = Math.max(...items.map((item) => item.label.length)) + 2;
  const lines = [title];
  for (const item of items) {
    lines.push(`  ${item.label.padEnd(maxLabelLength)}${item.description}`);
  }
  return lines.join('\n');
}

function renderTextSection(title: string, lines: ReadonlyArray<string>): string {
  if (lines.length === 0) {
    return `${title}\n  (none)`;
  }
  return [title, ...lines.map((line) => `  ${line}`)].join('\n');
}

function renderCommandSection(
  commands: Array<{ name: string; schema: CommandSchema; usage: string }>,
): string {
  return renderAlignedSection(
    'Commands:',
    commands.map((command) => ({
      label: command.usage,
      description: command.schema.summary ?? command.schema.helpDescription,
    })),
  );
}

export function buildCommandUsageText(commandName: string): string | null {
  const topicHelp = buildHelpTopicUsageText(commandName);
  if (topicHelp) return topicHelp;
  const schema = getCommandSchema(commandName);
  if (!schema) return null;
  const usage = buildCommandUsage(commandName, schema);
  const commandFlags = listHelpFlags(new Set<FlagKey>(schema.allowedFlags));
  const globalFlags = listHelpFlags(GLOBAL_FLAG_KEYS);
  const sections: string[] = [];
  if (commandFlags.length > 0) {
    sections.push(renderFlagSection('Command flags:', commandFlags));
  }
  sections.push(renderFlagSection('Global flags:', globalFlags));

  return `agent-device ${usage}

${schema.helpDescription}

Usage:
  agent-device ${usage}

${sections.join('\n\n')}
`;
}

function buildHelpTopicUsageText(topicName: string): string | null {
  const topic = HELP_TOPICS[topicName as keyof typeof HELP_TOPICS];
  if (!topic) return null;
  return `${topic.body}

Related:
  agent-device help                  command list and global flags
  agent-device help <command>        command-specific flags
  agent-device help workflow         normal app automation loop
`;
}
