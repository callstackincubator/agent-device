import { SETTINGS_USAGE_OVERRIDE } from '../core/settings-contract.ts';

export type CliFlags = {
  json: boolean;
  config?: string;
  stateDir?: string;
  daemonBaseUrl?: string;
  daemonAuthToken?: string;
  daemonTransport?: 'auto' | 'socket' | 'http';
  daemonServerMode?: 'socket' | 'http' | 'dual';
  tenant?: string;
  sessionIsolation?: 'none' | 'tenant';
  runId?: string;
  leaseId?: string;
  sessionLock?: 'reject' | 'strip';
  sessionLocked?: boolean;
  sessionLockConflicts?: 'reject' | 'strip';
  platform?: 'ios' | 'android' | 'apple';
  target?: 'mobile' | 'tv';
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
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  baseline?: string;
  threshold?: string;
  appsFilter?: 'user-installed' | 'all';
  count?: number;
  fps?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  activity?: string;
  header?: string[];
  saveScript?: boolean | string;
  shutdown?: boolean;
  relaunch?: boolean;
  headless?: boolean;
  restart?: boolean;
  noRecord?: boolean;
  retainPaths?: boolean;
  retentionMs?: number;
  replayUpdate?: boolean;
  steps?: string;
  stepsFile?: string;
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

const AGENT_SKILLS = [
  { label: 'agent-device', description: 'Canonical mobile automation flows' },
  { label: 'dogfood', description: 'Exploratory QA and bug hunts' },
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
] as const;

const EXAMPLE_LINES = [
  'agent-device open Settings --platform ios',
  'agent-device snapshot -i',
  'agent-device fill @e3 "test@example.com"',
  'agent-device replay ./session.ad',
] as const;

const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: 'config',
    names: ['--config'],
    type: 'string',
    usageLabel: '--config <path>',
    usageDescription: 'Load CLI defaults from a specific config file',
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
    enumValues: ['ios', 'android', 'apple'],
    usageLabel: '--platform ios|android|apple',
    usageDescription: 'Platform to target (`apple` aliases the iOS/tvOS backend)',
  },
  {
    key: 'target',
    names: ['--target'],
    type: 'enum',
    enumValues: ['mobile', 'tv'],
    usageLabel: '--target mobile|tv',
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
    usageDescription: 'runtime set: session-scoped Metro/debug host hint',
  },
  {
    key: 'metroPort',
    names: ['--metro-port'],
    type: 'int',
    min: 1,
    max: 65535,
    usageLabel: '--metro-port <port>',
    usageDescription: 'runtime set: session-scoped Metro/debug port hint',
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
    usageDescription: 'metro prepare: public base URL used to build bundle hints',
  },
  {
    key: 'metroProxyBaseUrl',
    names: ['--proxy-base-url'],
    type: 'string',
    usageLabel: '--proxy-base-url <url>',
    usageDescription: 'metro prepare: optional agent-device-proxy base URL for Metro bridging',
  },
  {
    key: 'metroBearerToken',
    names: ['--bearer-token'],
    type: 'string',
    usageLabel: '--bearer-token <token>',
    usageDescription:
      'metro prepare: proxy bearer token (prefer AGENT_DEVICE_PROXY_TOKEN or AGENT_DEVICE_METRO_BEARER_TOKEN)',
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
    usageDescription: 'runtime set: session-scoped bundle URL hint',
  },
  {
    key: 'launchUrl',
    names: ['--launch-url'],
    type: 'string',
    usageLabel: '--launch-url <url>',
    usageDescription: 'runtime set: session-scoped deep link / launch URL hint',
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
    key: 'intervalMs',
    names: ['--interval-ms'],
    type: 'int',
    min: 0,
    max: 10_000,
    usageLabel: '--interval-ms <ms>',
    usageDescription: 'Delay between press iterations',
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
    key: 'doubleTap',
    names: ['--double-tap'],
    type: 'boolean',
    usageLabel: '--double-tap',
    usageDescription: 'Use double-tap gesture per press iteration',
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
    key: 'saveScript',
    names: ['--save-script'],
    type: 'booleanOrString',
    usageLabel: '--save-script [path]',
    usageDescription: 'Save session script (.ad) on close; optional custom output path',
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
    key: 'out',
    names: ['--out'],
    type: 'string',
    usageLabel: '--out <path>',
    usageDescription: 'Output path',
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
  'stateDir',
  'daemonBaseUrl',
  'daemonAuthToken',
  'daemonTransport',
  'daemonServerMode',
  'tenant',
  'sessionIsolation',
  'runId',
  'leaseId',
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
    helpDescription: 'Boot device/simulator; optionally launch app or deep link URL',
    summary: 'Open an app, deep link or URL, save replays',
    positionalArgs: ['appOrUrl?', 'url?'],
    allowedFlags: ['activity', 'saveScript', 'relaunch'],
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
    helpDescription: 'Install app from a URL source through the normal daemon artifact flow',
    summary: 'Install app from a URL source',
    positionalArgs: ['url'],
    allowedFlags: ['header', 'retainPaths', 'retentionMs'],
  },
  push: {
    helpDescription: 'Simulate push notification payload delivery',
    summary: 'Deliver push payload',
    positionalArgs: ['bundleOrPackage', 'payloadOrJson'],
    allowedFlags: [],
  },
  snapshot: {
    helpDescription: 'Capture accessibility tree',
    positionalArgs: [],
    allowedFlags: [...SNAPSHOT_FLAGS],
  },
  diff: {
    usageOverride:
      'diff snapshot | diff screenshot --baseline <path> [--out <diff.png>] [--threshold <0-1>]',
    helpDescription: 'Diff accessibility snapshot or compare screenshots pixel-by-pixel',
    summary: 'Diff snapshot or screenshot',
    positionalArgs: ['kind'],
    allowedFlags: [...SNAPSHOT_FLAGS, 'baseline', 'threshold', 'out'],
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
  runtime: {
    usageOverride: 'runtime set|show|clear',
    helpDescription: 'Manage session-scoped runtime hints',
    summary: 'Manage runtime hints',
    positionalArgs: ['set|show|clear'],
    allowedFlags: ['metroHost', 'metroPort', 'bundleUrl', 'launchUrl'],
    skipCapabilityCheck: true,
  },
  metro: {
    usageOverride:
      'metro prepare --public-base-url <url> [--project-root <path>] [--port <port>] [--kind auto|react-native|expo]',
    helpDescription:
      'Prepare a local Metro runtime and optionally bridge it through agent-device-proxy',
    summary: 'Prepare local Metro runtime',
    positionalArgs: ['prepare'],
    allowedFlags: [
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
    ],
    skipCapabilityCheck: true,
  },
  clipboard: {
    usageOverride: 'clipboard read | clipboard write <text>',
    helpDescription: 'Read or write device clipboard text',
    positionalArgs: ['read|write', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [],
  },
  keyboard: {
    usageOverride: 'keyboard [status|get|dismiss]',
    helpDescription: 'Inspect Android keyboard visibility/type or dismiss it',
    summary: 'Inspect or dismiss Android keyboard',
    positionalArgs: ['action?'],
    allowedFlags: [],
  },
  perf: {
    helpDescription: 'Show session performance metrics (startup timing)',
    summary: 'Show startup metrics',
    positionalArgs: [],
    allowedFlags: [],
  },
  back: {
    helpDescription: 'Navigate back (where supported)',
    summary: 'Go back',
    positionalArgs: [],
    allowedFlags: [],
  },
  home: {
    helpDescription: 'Go to home screen (where supported)',
    summary: 'Go home',
    positionalArgs: [],
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
    helpDescription: 'Inspect or handle alert (iOS simulator)',
    summary: 'Inspect or handle iOS alert',
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
      ...SELECTOR_SNAPSHOT_FLAGS,
    ],
  },
  get: {
    usageOverride: 'get text|attrs <@ref|selector>',
    helpDescription: 'Return element text/attributes by ref or selector',
    summary: 'Get text or attrs by ref or selector',
    positionalArgs: ['subcommand', 'target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  replay: {
    helpDescription: 'Replay a recorded session',
    positionalArgs: ['path'],
    allowedFlags: ['replayUpdate'],
    skipCapabilityCheck: true,
  },
  batch: {
    usageOverride: 'batch [--steps <json> | --steps-file <path>]',
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
    allowedFlags: [],
  },
  fill: {
    usageOverride: 'fill <x> <y> <text> | fill <@ref|selector> <text>',
    helpDescription: 'Tap then type',
    positionalArgs: ['targetOrX', 'yOrText', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  scroll: {
    helpDescription: 'Scroll in direction (0-1 amount)',
    summary: 'Scroll in a direction',
    positionalArgs: ['direction', 'amount?'],
    allowedFlags: [],
  },
  scrollintoview: {
    usageOverride: 'scrollintoview <text|@ref>',
    helpDescription: 'Scroll until text appears or a snapshot ref is brought into view',
    summary: 'Scroll until text or ref is visible',
    positionalArgs: ['target'],
    allowsExtraPositionals: true,
    allowedFlags: [],
  },
  pinch: {
    helpDescription: 'Pinch/zoom gesture (iOS simulator)',
    positionalArgs: ['scale', 'x?', 'y?'],
    allowedFlags: [],
  },
  screenshot: {
    helpDescription: 'Capture screenshot',
    positionalArgs: ['path?'],
    allowedFlags: ['out'],
  },
  'trigger-app-event': {
    usageOverride: 'trigger-app-event <event> [payloadJson]',
    helpDescription: 'Trigger app-defined event hook via deep link template',
    summary: 'Trigger app event hook',
    positionalArgs: ['event', 'payloadJson?'],
    allowedFlags: [],
  },
  record: {
    usageOverride: 'record start [path] [--fps <n>] | record stop',
    helpDescription: 'Start/stop screen recording',
    summary: 'Start or stop screen recording',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: ['fps'],
  },
  trace: {
    usageOverride: 'trace start [path] | trace stop [path]',
    helpDescription: 'Start/stop trace log capture',
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
      'network dump [limit] [summary|headers|body|all] | network log [limit] [summary|headers|body|all]',
    helpDescription: 'Dump recent HTTP(s) traffic parsed from the session app log',
    summary: 'Show recent HTTP traffic',
    positionalArgs: ['dump|log', 'limit?', 'include?'],
    allowedFlags: [],
  },
  find: {
    usageOverride: 'find <locator|text> <action> [value]',
    helpDescription: 'Find by text/label/value/role/id and run action',
    summary: 'Find an element and act',
    positionalArgs: ['query', 'action', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...FIND_SNAPSHOT_FLAGS],
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
      'Toggle OS settings, appearance, and app permissions (session app scope for permission actions)',
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
  const skillsSection = [
    renderAlignedSection('Agent Skills:', AGENT_SKILLS),
    'See `skills/<name>/SKILL.md` in the installed package.',
  ].join('\n\n');
  const configSection = renderTextSection('Configuration:', CONFIGURATION_LINES);
  const environmentSection = renderAlignedSection('Environment:', ENVIRONMENT_LINES);
  const examplesSection = renderTextSection('Examples:', EXAMPLE_LINES);

  return `${header}
${commandLines}

${flagsSection}

${skillsSection}

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
