import { SETTINGS_USAGE_OVERRIDE } from '../core/settings-contract.ts';
import type { CommandName } from '../commands/command-metadata.ts';
import { DEFAULT_APPS_FILTER } from '../commands/app-inventory-contract.ts';
import { SCREENSHOT_COMMAND_FLAG_KEYS } from '../commands/capture-screenshot-options.ts';
import type { LocalCliCommandName } from '../command-catalog.ts';
import type { CommandSchema, CommandSchemaOverride } from './cli-command-schema-types.ts';
import {
  METRO_PREPARE_FLAGS,
  METRO_RELOAD_FLAGS,
  REPEATED_TOUCH_FLAGS,
  REPLAY_FLAGS,
  SELECTOR_SNAPSHOT_FLAGS,
  SNAPSHOT_FLAGS,
} from './cli-flags.ts';

type SchemaOnlyCliCommandName = Exclude<LocalCliCommandName, CommandName>;

const SCHEMA_ONLY_CLI_COMMAND_SCHEMAS = {
  auth: {
    usageOverride: 'auth status|login|logout',
    listUsageOverride: 'auth status|login|logout',
    helpDescription: 'Manage cloud CLI authentication',
    summary: 'Manage cloud authentication',
    positionalArgs: ['status|login|logout'],
  },
  connect: {
    usageOverride:
      'connect [--remote-config <path>] [--tenant <id>] [--run-id <id>] [--lease-backend <backend>] [--force] [--no-login]',
    helpDescription:
      'Connect to a remote daemon, authenticate when needed, and save remote session state. AGENT_DEVICE_CLOUD_BASE_URL is the bridge/control-plane API origin; use AGENT_DEVICE_DAEMON_AUTH_TOKEN=adc_live_... for CI/service-token automation.',
    summary: 'Connect to remote daemon',
    allowedFlags: ['force', 'noLogin', ...METRO_PREPARE_FLAGS, 'launchUrl'],
  },
  connection: {
    usageOverride: 'connection status',
    listUsageOverride: 'connection status',
    helpDescription: 'Inspect active remote connection state',
    summary: 'Inspect remote connection',
    positionalArgs: ['status'],
  },
  disconnect: {
    helpDescription:
      'Disconnect remote daemon state, stop owned Metro companion, and release lease',
    summary: 'Disconnect remote daemon',
    allowedFlags: ['shutdown'],
  },
  mcp: {
    helpDescription:
      'Start the official stdio MCP server. It exposes structured command tools backed by the agent-device client.',
    summary: 'Start MCP server',
  },
  'react-devtools': {
    usageOverride: 'react-devtools [...args]',
    listUsageOverride: 'react-devtools [...args]',
    helpDescription:
      'Run pinned agent-react-devtools commands for React Native performance profiling, component trees, props/state/hooks, and render analysis',
    summary: 'Profile React Native performance and component renders',
    positionalArgs: ['args?'],
    allowsExtraPositionals: true,
  },
} as const satisfies Record<SchemaOnlyCliCommandName, CommandSchema>;

const CLI_COMMAND_OVERRIDES = {
  boot: {
    summary: 'Boot target device/simulator',
    allowedFlags: ['headless'],
  },
  prepare: {
    usageOverride: 'prepare ios-runner --platform ios|macos [--timeout <ms>]',
    listUsageOverride: 'prepare ios-runner --platform ios|macos',
    helpDescription:
      'Prepare platform helper infrastructure. ios-runner builds/reuses, starts, and health-checks the XCTest runner so later Apple snapshots and interactions do not pay first-use startup cost. In CI, run it after boot/install and before replay/test; if replay/test starts a separate daemon, run clean:daemon after prepare to release the prepared runner lease. Runner build/start output is written to the session runner.log; daemon.log is for daemon lifecycle/startup issues.',
    summary: 'Prepare platform helpers',
    positionalArgs: ['ios-runner'],
    allowedFlags: ['timeoutMs'],
  },
  open: {
    helpDescription:
      'Boot device/simulator; optionally launch app or deep link URL (macOS also supports --surface app|frontmost-app|desktop|menubar)',
    summary: 'Open an app, deep link or URL, save replays',
    positionalArgs: ['appOrUrl?', 'url?'],
    allowedFlags: ['activity', 'launchConsole', 'launchArgs', 'saveScript', 'relaunch', 'surface'],
  },
  close: {
    positionalArgs: ['app?'],
    allowedFlags: ['saveScript', 'shutdown'],
  },
  reinstall: {
    positionalArgs: ['app', 'path'],
  },
  install: {
    positionalArgs: ['app', 'path'],
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
  apps: {
    helpDescription: 'List user-installed apps; use --all to include system/OEM apps',
    summary: 'List installed apps',
    allowedFlags: ['appsFilter'],
    defaults: { appsFilter: DEFAULT_APPS_FILTER },
  },
  push: {
    positionalArgs: ['bundleOrPackage', 'payloadOrJson'],
  },
  snapshot: {
    usageOverride:
      'snapshot [--diff] [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--force-full] [--timeout <ms>]',
    helpDescription: 'Capture accessibility tree or diff against the previous session baseline',
    allowedFlags: ['snapshotDiff', ...SNAPSHOT_FLAGS, 'snapshotForceFull', 'timeoutMs'],
  },
  diff: {
    usageOverride:
      'diff snapshot | diff screenshot --baseline <path> [current.png] [--out <diff.png>] [--threshold <0-1>] [--overlay-refs]',
    helpDescription: 'Diff accessibility snapshot or compare screenshots pixel-by-pixel',
    summary: 'Diff snapshot or screenshot',
    positionalArgs: ['kind', 'current?'],
    allowedFlags: [...SNAPSHOT_FLAGS, 'baseline', 'threshold', 'out', 'overlayRefs'],
  },
  screenshot: {
    helpDescription:
      'Capture screenshot (macOS app sessions default to the app window; use --fullscreen for full desktop, --max-size to downscale, --overlay-refs to annotate current refs, or --no-stabilize for low-latency Android capture loops)',
    positionalArgs: ['path?'],
    allowedFlags: SCREENSHOT_COMMAND_FLAG_KEYS,
  },
  appstate: {
    helpDescription: 'Show foreground app/activity',
  },
  perf: {
    usageOverride: 'perf [metrics|frames] [sample]',
    listUsageOverride: 'perf [metrics|frames]',
    helpDescription:
      'Show session performance metrics or focused frame/jank health. Bare perf and metrics are aliases for perf metrics.',
    summary: 'Show session performance and frame health',
    positionalArgs: ['area?', 'action?'],
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
    allowedFlags: [...METRO_RELOAD_FLAGS, ...METRO_PREPARE_FLAGS],
  },
  clipboard: {
    usageOverride: 'clipboard read | clipboard write <text>',
    listUsageOverride: 'clipboard read | clipboard write <text>',
    helpDescription: 'Read or write device clipboard text',
    positionalArgs: ['read|write', 'text?'],
    allowsExtraPositionals: true,
  },
  keyboard: {
    usageOverride: 'keyboard [status|get|dismiss|enter|return]',
    helpDescription:
      'Inspect Android keyboard visibility/type or press/dismiss the device keyboard',
    summary: 'Inspect, press, or dismiss the device keyboard',
    positionalArgs: ['action?'],
  },
  back: {
    usageOverride: 'back [--in-app|--system]',
    allowedFlags: ['backMode'],
  },
  rotate: {
    usageOverride: 'rotate <portrait|portrait-upside-down|landscape-left|landscape-right>',
    helpDescription: 'Rotate device orientation on iOS and Android',
    positionalArgs: ['orientation'],
  },
  wait: {
    usageOverride: 'wait <ms>|text <text>|@ref|<selector> [timeoutMs]',
    positionalArgs: ['durationOrSelector', 'timeoutMs?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  get: {
    usageOverride: 'get text|attrs <@ref|selector>',
    positionalArgs: ['subcommand', 'target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  find: {
    usageOverride: 'find <locator|text> <action> [value] [--first|--last]',
    helpDescription: 'Find by text/label/value/role/id and run action',
    summary: 'Find an element and act',
    positionalArgs: ['query', 'action', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: ['snapshotDepth', 'snapshotRaw', 'findFirst', 'findLast'],
  },
  is: {
    positionalArgs: ['predicate', 'selector', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  alert: {
    usageOverride: 'alert [get|accept|dismiss|wait] [timeout]',
    positionalArgs: ['action?', 'timeout?'],
  },
  click: {
    usageOverride: 'click <x y|@ref|selector>',
    positionalArgs: ['target'],
    allowsExtraPositionals: true,
    allowedFlags: [...REPEATED_TOUCH_FLAGS, 'clickButton', ...SELECTOR_SNAPSHOT_FLAGS],
  },
  replay: {
    positionalArgs: ['path'],
    allowedFlags: ['replayMaestro', ...REPLAY_FLAGS, 'timeoutMs'],
  },
  test: {
    usageOverride: 'test <path-or-glob>...',
    listUsageOverride: 'test <path-or-glob>...',
    helpDescription: 'Run one or more replay scripts as a serial test suite',
    summary: 'Run replay test suites',
    positionalArgs: ['pathOrGlob'],
    allowsExtraPositionals: true,
    allowedFlags: [
      'replayMaestro',
      ...REPLAY_FLAGS,
      'failFast',
      'timeoutMs',
      'retries',
      'artifactsDir',
      'reportJunit',
      'shardAll',
      'shardSplit',
    ],
  },
  batch: {
    usageOverride: 'batch [--steps <json> | --steps-file <path>]',
    listUsageOverride: 'batch --steps <json> | --steps-file <path>',
    helpDescription: 'Execute multiple commands in one daemon request',
    summary: 'Run multiple commands',
    allowedFlags: ['steps', 'stepsFile', 'batchOnError', 'batchMaxSteps', 'out'],
  },
  press: {
    usageOverride: 'press <x y|@ref|selector>',
    positionalArgs: ['targetOrX', 'y?'],
    allowsExtraPositionals: true,
    allowedFlags: [...REPEATED_TOUCH_FLAGS, ...SELECTOR_SNAPSHOT_FLAGS],
  },
  longpress: {
    usageOverride: 'longpress <x y|@ref|selector> [durationMs]',
    positionalArgs: ['targetOrX', 'yOrDurationMs?', 'durationMs?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  swipe: {
    helpDescription: 'Swipe coordinates with optional repeat pattern',
    positionalArgs: ['x1', 'y1', 'x2', 'y2', 'durationMs?'],
    allowedFlags: ['count', 'pauseMs', 'pattern'],
  },
  gesture: {
    usageOverride: 'gesture <pan|fling|swipe|pinch|rotate|transform> ...',
    listUsageOverride: 'gesture <pan|fling|swipe|pinch|rotate|transform> ...',
    helpDescription:
      'Run touch gestures: pan <x> <y> <dx> <dy> [durationMs], fling <up|down|left|right> <x> <y> [distance] [durationMs], swipe <left|right|left-edge|right-edge> [durationMs], pinch <scale> [x] [y], rotate <degrees> [x] [y] [velocity], or transform <x> <y> <dx> <dy> <scale> <degrees> [durationMs]',
    summary: 'Run pan, fling, swipe, pinch, rotate, or transform gestures',
    positionalArgs: ['pan|fling|swipe|pinch|rotate|transform', 'args?'],
    allowsExtraPositionals: true,
  },
  focus: {
    positionalArgs: ['x', 'y'],
  },
  type: {
    positionalArgs: ['text'],
    allowsExtraPositionals: true,
    allowedFlags: ['delayMs'],
  },
  fill: {
    usageOverride: 'fill <x> <y> <text> | fill <@ref|selector> <text>',
    positionalArgs: ['targetOrX', 'yOrText', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS, 'delayMs'],
  },
  scroll: {
    usageOverride: 'scroll <direction|top|bottom> [amount] [--pixels <n>]',
    helpDescription: 'Scroll in direction, or verify hidden content and scroll toward top/bottom',
    summary: 'Scroll in a direction or to an edge',
    positionalArgs: ['directionOrEdge', 'amount?'],
    allowedFlags: ['pixels'],
  },
  'trigger-app-event': {
    usageOverride: 'trigger-app-event <event> [payloadJson]',
    positionalArgs: ['event', 'payloadJson?'],
  },
  record: {
    usageOverride:
      'record start [path] [--fps <n>] [--quality <5-10>] [--hide-touches] | record stop',
    listUsageOverride: 'record start [path] | record stop',
    helpDescription:
      'Start/stop screen recording; Android recordings longer than the 180s adb screenrecord limit are returned as multiple MP4 chunks',
    summary: 'Start or stop screen recording',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: ['fps', 'quality', 'hideTouches'],
  },
  'react-native': {
    usageOverride: 'react-native dismiss-overlay',
    listUsageOverride: 'react-native dismiss-overlay',
    positionalArgs: ['dismiss-overlay'],
  },
  trace: {
    usageOverride: 'trace start <path> | trace stop <path>',
    listUsageOverride: 'trace start <path> | trace stop <path>',
    helpDescription:
      'Start/stop trace log capture; when an artifact path is requested, pass the same positional path to start and stop',
    summary: 'Start or stop trace capture',
    positionalArgs: ['start|stop', 'path?'],
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
  settings: {
    usageOverride: SETTINGS_USAGE_OVERRIDE,
    listUsageOverride: 'settings [area] [options]',
    helpDescription:
      'Toggle OS settings, animation scales, appearance, and app permissions (macOS supports only settings appearance <light|dark|toggle> and settings permission <grant|reset> <accessibility|screen-recording|input-monitoring>; wifi|airplane|location|animations remain unsupported on macOS; mobile permission actions use the active session app)',
    summary: 'Change OS settings and app permissions',
    positionalArgs: ['setting', 'state', 'target?', 'mode?'],
  },
  session: {
    usageOverride: 'session list',
    positionalArgs: ['list?'],
  },
} as const satisfies Partial<Record<CommandName, CommandSchemaOverride>>;

export function getSchemaOnlyCliCommandSchema(command: string): CommandSchema | undefined {
  return Object.hasOwn(SCHEMA_ONLY_CLI_COMMAND_SCHEMAS, command)
    ? SCHEMA_ONLY_CLI_COMMAND_SCHEMAS[command as keyof typeof SCHEMA_ONLY_CLI_COMMAND_SCHEMAS]
    : undefined;
}

export function getCliCommandOverride(command: string): CommandSchemaOverride | undefined {
  return Object.hasOwn(CLI_COMMAND_OVERRIDES, command)
    ? CLI_COMMAND_OVERRIDES[command as keyof typeof CLI_COMMAND_OVERRIDES]
    : undefined;
}
