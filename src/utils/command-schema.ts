export type CliFlags = {
  json: boolean;
  platform?: 'ios' | 'android';
  device?: string;
  udid?: string;
  serial?: string;
  out?: string;
  session?: string;
  verbose?: boolean;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  snapshotBackend?: 'ax' | 'xctest';
  appsFilter?: 'launchable' | 'user-installed' | 'all';
  appsMetadata?: boolean;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  activity?: string;
  saveScript?: boolean;
  relaunch?: boolean;
  noRecord?: boolean;
  replayUpdate?: boolean;
  help: boolean;
  version: boolean;
};

export type DaemonFlags = Omit<CliFlags, 'json' | 'help' | 'version'>;
export type FlagKey = keyof CliFlags;
export type FlagType = 'boolean' | 'int' | 'enum' | 'string';

export type FlagDefinition = {
  key: FlagKey;
  names: readonly string[];
  type: FlagType;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  setValue?: CliFlags[FlagKey];
  usageLabel?: string;
  usageDescription?: string;
};

export type CommandSchema = {
  name: string;
  capabilityKey: string | null;
  usage: string;
  description: string;
  details?: readonly string[];
  positionalArgs: readonly string[];
  allowsExtraPositionals?: boolean;
  allowedFlags: readonly FlagKey[];
  defaults?: Partial<CliFlags>;
};

const SNAPSHOT_FLAGS = [
  'snapshotInteractiveOnly',
  'snapshotCompact',
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
  'snapshotBackend',
] as const satisfies readonly FlagKey[];

const SELECTOR_SNAPSHOT_FLAGS = [
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
  'snapshotBackend',
] as const satisfies readonly FlagKey[];

const FIND_SNAPSHOT_FLAGS = ['snapshotDepth', 'snapshotRaw', 'snapshotBackend'] as const satisfies readonly FlagKey[];

export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: 'platform',
    names: ['--platform'],
    type: 'enum',
    enumValues: ['ios', 'android'],
    usageLabel: '--platform ios|android',
    usageDescription: 'Platform to target',
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
    key: 'activity',
    names: ['--activity'],
    type: 'string',
    usageLabel: '--activity <component>',
    usageDescription: 'Android app launch activity (package/Activity); not for URL opens',
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
    names: ['--verbose', '-v'],
    type: 'boolean',
    usageLabel: '--verbose',
    usageDescription: 'Stream daemon/runner logs',
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
    type: 'boolean',
    usageLabel: '--save-script',
    usageDescription: 'Save session script (.ad) on close',
  },
  {
    key: 'relaunch',
    names: ['--relaunch'],
    type: 'boolean',
    usageLabel: '--relaunch',
    usageDescription: 'open: terminate app process before launching it',
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
    key: 'appsFilter',
    names: ['--user-installed'],
    type: 'enum',
    enumValues: ['launchable', 'user-installed', 'all'],
    setValue: 'user-installed',
    usageLabel: '--user-installed',
    usageDescription: 'Apps: list user-installed packages (Android only)',
  },
  {
    key: 'appsFilter',
    names: ['--all'],
    type: 'enum',
    enumValues: ['launchable', 'user-installed', 'all'],
    setValue: 'all',
    usageLabel: '--all',
    usageDescription: 'Apps: list all packages (Android only)',
  },
  {
    key: 'appsMetadata',
    names: ['--metadata'],
    type: 'boolean',
    usageLabel: '--metadata',
    usageDescription: 'Apps: return metadata objects',
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
    key: 'snapshotBackend',
    names: ['--backend'],
    type: 'enum',
    enumValues: ['ax', 'xctest'],
    usageLabel: '--backend ax|xctest',
    usageDescription: 'Snapshot backend (iOS): ax or xctest',
  },
  {
    key: 'out',
    names: ['--out'],
    type: 'string',
    usageLabel: '--out <path>',
    usageDescription: 'Output path',
  },
];

export const GLOBAL_FLAG_KEYS = new Set<FlagKey>([
  'json',
  'help',
  'version',
  'verbose',
  'platform',
  'device',
  'udid',
  'serial',
  'session',
  'noRecord',
]);

export const CLI_COMMAND_ORDER = [
  'boot',
  'open',
  'close',
  'reinstall',
  'snapshot',
  'devices',
  'apps',
  'appstate',
  'back',
  'home',
  'app-switcher',
  'wait',
  'alert',
  'click',
  'get',
  'replay',
  'press',
  'long-press',
  'swipe',
  'focus',
  'type',
  'fill',
  'scroll',
  'scrollintoview',
  'pinch',
  'screenshot',
  'record',
  'trace',
  'find',
  'is',
  'settings',
  'session',
] as const;

export const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
  boot: {
    name: 'boot',
    capabilityKey: 'boot',
    usage: 'boot',
    description: 'Ensure target device/simulator is booted and ready',
    positionalArgs: [],
    allowedFlags: [],
  },
  open: {
    name: 'open',
    capabilityKey: 'open',
    usage: 'open [app|url]',
    description: 'Boot device/simulator; optionally launch app or deep link URL',
    positionalArgs: ['appOrUrl?'],
    allowedFlags: ['activity', 'saveScript', 'relaunch'],
  },
  close: {
    name: 'close',
    capabilityKey: 'close',
    usage: 'close [app]',
    description: 'Close app or just end session',
    positionalArgs: ['app?'],
    allowedFlags: ['saveScript'],
  },
  reinstall: {
    name: 'reinstall',
    capabilityKey: 'reinstall',
    usage: 'reinstall <app> <path>',
    description: 'Uninstall + install app from binary path',
    positionalArgs: ['app', 'path'],
    allowedFlags: [],
  },
  snapshot: {
    name: 'snapshot',
    capabilityKey: 'snapshot',
    usage: 'snapshot [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--backend ax|xctest]',
    description: 'Capture accessibility tree',
    details: [
      '-i: Interactive elements only',
      '-c: Compact output (drop empty structure)',
      '-d <depth>: Limit snapshot depth',
      '-s <scope>: Scope snapshot to label/identifier',
      '--raw: Raw node output',
      '--backend ax|xctest: xctest is default; ax is faster but needs permissions',
    ],
    positionalArgs: [],
    allowedFlags: [...SNAPSHOT_FLAGS],
  },
  devices: {
    name: 'devices',
    capabilityKey: null,
    usage: 'devices',
    description: 'List available devices',
    positionalArgs: [],
    allowedFlags: [],
  },
  apps: {
    name: 'apps',
    capabilityKey: 'apps',
    usage: 'apps [--user-installed|--all|--metadata]',
    description: 'List installed apps (Android launchable by default, iOS simulator)',
    positionalArgs: [],
    allowedFlags: ['appsFilter', 'appsMetadata'],
  },
  appstate: {
    name: 'appstate',
    capabilityKey: null,
    usage: 'appstate',
    description: 'Show foreground app/activity',
    positionalArgs: [],
    allowedFlags: [],
  },
  back: {
    name: 'back',
    capabilityKey: 'back',
    usage: 'back',
    description: 'Navigate back (where supported)',
    positionalArgs: [],
    allowedFlags: [],
  },
  home: {
    name: 'home',
    capabilityKey: 'home',
    usage: 'home',
    description: 'Go to home screen (where supported)',
    positionalArgs: [],
    allowedFlags: [],
  },
  'app-switcher': {
    name: 'app-switcher',
    capabilityKey: 'app-switcher',
    usage: 'app-switcher',
    description: 'Open app switcher (where supported)',
    positionalArgs: [],
    allowedFlags: [],
  },
  wait: {
    name: 'wait',
    capabilityKey: 'wait',
    usage: 'wait <ms>|text <text>|@ref|<selector> [timeoutMs]',
    description: 'Wait for duration, text, ref, or selector to appear',
    positionalArgs: ['durationOrSelector', 'timeoutMs?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  alert: {
    name: 'alert',
    capabilityKey: 'alert',
    usage: 'alert [get|accept|dismiss|wait] [timeout]',
    description: 'Inspect or handle alert (iOS simulator)',
    positionalArgs: ['action?', 'timeout?'],
    allowedFlags: [],
  },
  click: {
    name: 'click',
    capabilityKey: 'click',
    usage: 'click <@ref|selector>',
    description: 'Click element by snapshot ref or selector',
    positionalArgs: ['target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  get: {
    name: 'get',
    capabilityKey: 'get',
    usage: 'get text|attrs <@ref|selector>',
    description: 'Return element text/attributes by ref or selector',
    positionalArgs: ['subcommand', 'target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  replay: {
    name: 'replay',
    capabilityKey: null,
    usage: 'replay <path> [--update|-u]',
    description: 'Replay a recorded session',
    positionalArgs: ['path'],
    allowedFlags: ['replayUpdate'],
  },
  press: {
    name: 'press',
    capabilityKey: 'press',
    usage: 'press <x> <y> [--count N] [--interval-ms I] [--hold-ms H] [--jitter-px J]',
    description: 'Tap/press at coordinates (supports repeated gesture series)',
    positionalArgs: ['x', 'y'],
    allowedFlags: ['count', 'intervalMs', 'holdMs', 'jitterPx'],
  },
  'long-press': {
    name: 'long-press',
    capabilityKey: 'long-press',
    usage: 'long-press <x> <y> [durationMs]',
    description: 'Long press (where supported)',
    positionalArgs: ['x', 'y', 'durationMs?'],
    allowedFlags: [],
  },
  swipe: {
    name: 'swipe',
    capabilityKey: 'swipe',
    usage: 'swipe <x1> <y1> <x2> <y2> [durationMs] [--count N] [--pause-ms P] [--pattern one-way|ping-pong]',
    description: 'Swipe coordinates with optional repeat pattern',
    positionalArgs: ['x1', 'y1', 'x2', 'y2', 'durationMs?'],
    allowedFlags: ['count', 'pauseMs', 'pattern'],
  },
  focus: {
    name: 'focus',
    capabilityKey: 'focus',
    usage: 'focus <x> <y>',
    description: 'Focus input at coordinates',
    positionalArgs: ['x', 'y'],
    allowedFlags: [],
  },
  type: {
    name: 'type',
    capabilityKey: 'type',
    usage: 'type <text>',
    description: 'Type text in focused field',
    positionalArgs: ['text'],
    allowsExtraPositionals: true,
    allowedFlags: [],
  },
  fill: {
    name: 'fill',
    capabilityKey: 'fill',
    usage: 'fill <x> <y> <text> | fill <@ref|selector> <text>',
    description: 'Tap then type',
    positionalArgs: ['targetOrX', 'yOrText', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  scroll: {
    name: 'scroll',
    capabilityKey: 'scroll',
    usage: 'scroll <direction> [amount]',
    description: 'Scroll in direction (0-1 amount)',
    positionalArgs: ['direction', 'amount?'],
    allowedFlags: [],
  },
  scrollintoview: {
    name: 'scrollintoview',
    capabilityKey: null,
    usage: 'scrollintoview <text>',
    description: 'Scroll until text appears (Android only)',
    positionalArgs: ['text'],
    allowedFlags: [],
  },
  pinch: {
    name: 'pinch',
    capabilityKey: 'pinch',
    usage: 'pinch <scale> [x] [y]',
    description: 'Pinch/zoom gesture (iOS simulator)',
    positionalArgs: ['scale', 'x?', 'y?'],
    allowedFlags: [],
  },
  screenshot: {
    name: 'screenshot',
    capabilityKey: 'screenshot',
    usage: 'screenshot [path]',
    description: 'Capture screenshot',
    positionalArgs: ['path?'],
    allowedFlags: ['out'],
  },
  record: {
    name: 'record',
    capabilityKey: 'record',
    usage: 'record start [path] | record stop',
    description: 'Start/stop screen recording',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: [],
  },
  trace: {
    name: 'trace',
    capabilityKey: null,
    usage: 'trace start [path] | trace stop [path]',
    description: 'Start/stop trace log capture',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: [],
  },
  find: {
    name: 'find',
    capabilityKey: 'find',
    usage: 'find <locator|text> <action> [value]',
    description: 'Find by text/label/value/role/id and run action',
    details: [
      'find text <text> <action> [value]',
      'find label <label> <action> [value]',
      'find value <value> <action> [value]',
      'find role <role> <action> [value]',
      'find id <id> <action> [value]',
    ],
    positionalArgs: ['query', 'action', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...FIND_SNAPSHOT_FLAGS],
  },
  is: {
    name: 'is',
    capabilityKey: 'is',
    usage: 'is <predicate> <selector> [value]',
    description: 'Assert UI state (visible|hidden|exists|editable|selected|text)',
    positionalArgs: ['predicate', 'selector', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  settings: {
    name: 'settings',
    capabilityKey: 'settings',
    usage: 'settings <wifi|airplane|location> <on|off>',
    description: 'Toggle OS settings (simulators)',
    positionalArgs: ['setting', 'state'],
    allowedFlags: [],
  },
  session: {
    name: 'session',
    capabilityKey: null,
    usage: 'session list',
    description: 'List active sessions',
    positionalArgs: ['list?'],
    allowedFlags: [],
  },
};

const FLAG_HELP_ORDER: readonly string[] = [
  '--platform',
  '--device',
  '--udid',
  '--serial',
  '--activity',
  '--session',
  '--count',
  '--interval-ms',
  '--hold-ms',
  '--jitter-px',
  '--pause-ms',
  '--pattern',
  '--verbose',
  '--json',
  '--save-script',
  '--relaunch',
  '--no-record',
  '--update',
  '--user-installed',
  '--all',
  '--metadata',
  '-i',
  '-c',
  '--depth',
  '--scope',
  '--raw',
  '--backend',
  '--out',
  '--help',
  '--version',
];

const flagDefinitionByName = new Map<string, FlagDefinition>();
for (const definition of FLAG_DEFINITIONS) {
  for (const name of definition.names) {
    flagDefinitionByName.set(name, definition);
  }
}

export function getFlagDefinition(token: string): FlagDefinition | undefined {
  return flagDefinitionByName.get(token);
}

export function getCommandSchema(command: string | null): CommandSchema | undefined {
  if (!command) return undefined;
  return COMMAND_SCHEMAS[command];
}

export function getCliCommandNames(): string[] {
  return [...CLI_COMMAND_ORDER];
}

export function getSchemaCapabilityKeys(): string[] {
  return Object.values(COMMAND_SCHEMAS)
    .map((schema) => schema.capabilityKey)
    .filter((key): key is string => typeof key === 'string')
    .sort();
}

export function isStrictFlagModeEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

let cachedUsageText: string | null = null;

export function buildUsageText(): string {
  if (cachedUsageText) return cachedUsageText;
  const header = `agent-device <command> [args] [--json]

CLI to control iOS and Android devices for AI agents.
`;

  const commands = CLI_COMMAND_ORDER.map((name) => {
    const schema = COMMAND_SCHEMAS[name];
    if (!schema) throw new Error(`Missing command schema for ${name}`);
    return schema;
  });
  const maxUsage = Math.max(...commands.map((command) => command.usage.length)) + 2;
  const commandLines: string[] = ['Commands:'];
  for (const command of commands) {
    commandLines.push(`  ${command.usage.padEnd(maxUsage)}${command.description}`);
    for (const detail of command.details ?? []) {
      commandLines.push(`    ${detail}`);
    }
  }

  const helpFlags = FLAG_HELP_ORDER
    .map((token) => flagDefinitionByName.get(token))
    .filter((definition): definition is FlagDefinition => Boolean(definition))
    .filter((definition, index, all) => all.indexOf(definition) === index)
    .filter((definition) => definition.usageLabel && definition.usageDescription);
  const maxFlagLabel = Math.max(...helpFlags.map((flag) => (flag.usageLabel ?? '').length)) + 2;
  const flagLines: string[] = ['Flags:'];
  for (const flag of helpFlags) {
    flagLines.push(
      `  ${(flag.usageLabel ?? '').padEnd(maxFlagLabel)}${flag.usageDescription ?? ''}`,
    );
  }

  cachedUsageText = `${header}
${commandLines.join('\n')}

${flagLines.join('\n')}
`;
  return cachedUsageText;
}
