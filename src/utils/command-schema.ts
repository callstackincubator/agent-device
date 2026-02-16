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
  saveScript?: boolean | string;
  relaunch?: boolean;
  noRecord?: boolean;
  replayUpdate?: boolean;
  help: boolean;
  version: boolean;
};

export type FlagKey = keyof CliFlags;
export type FlagType = 'boolean' | 'int' | 'enum' | 'string' | 'booleanOrString';

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
  description: string;
  positionalArgs: readonly string[];
  allowsExtraPositionals?: boolean;
  allowedFlags: readonly FlagKey[];
  defaults?: Partial<CliFlags>;
  skipCapabilityCheck?: boolean;
  usageOverride?: string;
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
    type: 'booleanOrString',
    usageLabel: '--save-script [path]',
    usageDescription: 'Save session script (.ad) on close; optional custom output path',
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
    setValue: 'user-installed',
    usageLabel: '--user-installed',
    usageDescription: 'Apps: list user-installed packages (Android only)',
  },
  {
    key: 'appsFilter',
    names: ['--all'],
    type: 'enum',
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

export const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
  boot: {
    description: 'Ensure target device/simulator is booted and ready',
    positionalArgs: [],
    allowedFlags: [],
  },
  open: {
    description: 'Boot device/simulator; optionally launch app or deep link URL',
    positionalArgs: ['appOrUrl?'],
    allowedFlags: ['activity', 'saveScript', 'relaunch'],
  },
  close: {
    description: 'Close app or just end session',
    positionalArgs: ['app?'],
    allowedFlags: ['saveScript'],
  },
  reinstall: {
    description: 'Uninstall + install app from binary path',
    positionalArgs: ['app', 'path'],
    allowedFlags: [],
  },
  snapshot: {
    description: 'Capture accessibility tree',
    positionalArgs: [],
    allowedFlags: [...SNAPSHOT_FLAGS],
  },
  devices: {
    description: 'List available devices',
    positionalArgs: [],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  apps: {
    description: 'List installed apps (Android launchable by default, iOS simulator)',
    positionalArgs: [],
    allowedFlags: ['appsFilter', 'appsMetadata'],
  },
  appstate: {
    description: 'Show foreground app/activity',
    positionalArgs: [],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  back: {
    description: 'Navigate back (where supported)',
    positionalArgs: [],
    allowedFlags: [],
  },
  home: {
    description: 'Go to home screen (where supported)',
    positionalArgs: [],
    allowedFlags: [],
  },
  'app-switcher': {
    description: 'Open app switcher (where supported)',
    positionalArgs: [],
    allowedFlags: [],
  },
  wait: {
    usageOverride: 'wait <ms>|text <text>|@ref|<selector> [timeoutMs]',
    description: 'Wait for duration, text, ref, or selector to appear',
    positionalArgs: ['durationOrSelector', 'timeoutMs?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  alert: {
    usageOverride: 'alert [get|accept|dismiss|wait] [timeout]',
    description: 'Inspect or handle alert (iOS simulator)',
    positionalArgs: ['action?', 'timeout?'],
    allowedFlags: [],
  },
  click: {
    usageOverride: 'click <@ref|selector>',
    description: 'Click element by snapshot ref or selector',
    positionalArgs: ['target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  get: {
    usageOverride: 'get text|attrs <@ref|selector>',
    description: 'Return element text/attributes by ref or selector',
    positionalArgs: ['subcommand', 'target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  replay: {
    description: 'Replay a recorded session',
    positionalArgs: ['path'],
    allowedFlags: ['replayUpdate'],
    skipCapabilityCheck: true,
  },
  press: {
    description: 'Tap/press at coordinates (supports repeated gesture series)',
    positionalArgs: ['x', 'y'],
    allowedFlags: ['count', 'intervalMs', 'holdMs', 'jitterPx'],
  },
  'long-press': {
    description: 'Long press (where supported)',
    positionalArgs: ['x', 'y', 'durationMs?'],
    allowedFlags: [],
  },
  swipe: {
    description: 'Swipe coordinates with optional repeat pattern',
    positionalArgs: ['x1', 'y1', 'x2', 'y2', 'durationMs?'],
    allowedFlags: ['count', 'pauseMs', 'pattern'],
  },
  focus: {
    description: 'Focus input at coordinates',
    positionalArgs: ['x', 'y'],
    allowedFlags: [],
  },
  type: {
    description: 'Type text in focused field',
    positionalArgs: ['text'],
    allowsExtraPositionals: true,
    allowedFlags: [],
  },
  fill: {
    usageOverride: 'fill <x> <y> <text> | fill <@ref|selector> <text>',
    description: 'Tap then type',
    positionalArgs: ['targetOrX', 'yOrText', 'text?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  scroll: {
    description: 'Scroll in direction (0-1 amount)',
    positionalArgs: ['direction', 'amount?'],
    allowedFlags: [],
  },
  scrollintoview: {
    description: 'Scroll until text appears',
    positionalArgs: ['text'],
    allowedFlags: [],
  },
  pinch: {
    description: 'Pinch/zoom gesture (iOS simulator)',
    positionalArgs: ['scale', 'x?', 'y?'],
    allowedFlags: [],
  },
  screenshot: {
    description: 'Capture screenshot',
    positionalArgs: ['path?'],
    allowedFlags: ['out'],
  },
  record: {
    usageOverride: 'record start [path] | record stop',
    description: 'Start/stop screen recording',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: [],
  },
  trace: {
    usageOverride: 'trace start [path] | trace stop [path]',
    description: 'Start/stop trace log capture',
    positionalArgs: ['start|stop', 'path?'],
    allowedFlags: [],
    skipCapabilityCheck: true,
  },
  find: {
    usageOverride: 'find <locator|text> <action> [value]',
    description: 'Find by text/label/value/role/id and run action',
    positionalArgs: ['query', 'action', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...FIND_SNAPSHOT_FLAGS],
  },
  is: {
    description: 'Assert UI state (visible|hidden|exists|editable|selected|text)',
    positionalArgs: ['predicate', 'selector', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  settings: {
    description: 'Toggle OS settings (simulators)',
    positionalArgs: ['setting', 'state'],
    allowedFlags: [],
  },
  session: {
    usageOverride: 'session list',
    description: 'List active sessions',
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

function buildCommandUsage(commandName: string, schema: CommandSchema): string {
  if (schema.usageOverride) return schema.usageOverride;
  const positionals = schema.positionalArgs.map(formatPositionalArg);
  const flagLabels = schema.allowedFlags.flatMap((key) =>
    (flagDefinitionsByKey.get(key) ?? []).map((definition) => definition.usageLabel ?? definition.names[0]),
  );
  const optionalFlags = flagLabels.map((label) => `[${label}]`);
  return [commandName, ...positionals, ...optionalFlags].join(' ');
}

function renderUsageText(): string {
  const header = `agent-device <command> [args] [--json]

CLI to control iOS and Android devices for AI agents.
`;

  const commands = getCliCommandNames().map((name) => {
    const schema = COMMAND_SCHEMAS[name];
    if (!schema) throw new Error(`Missing command schema for ${name}`);
    return { name, schema, usage: buildCommandUsage(name, schema) };
  });
  const maxUsage = Math.max(...commands.map((command) => command.usage.length)) + 2;
  const commandLines: string[] = ['Commands:'];
  for (const command of commands) {
    commandLines.push(`  ${command.usage.padEnd(maxUsage)}${command.schema.description}`);
  }

  const helpFlags = FLAG_DEFINITIONS
    .filter((definition) => definition.usageLabel && definition.usageDescription);
  const maxFlagLabel = Math.max(...helpFlags.map((flag) => (flag.usageLabel ?? '').length)) + 2;
  const flagLines: string[] = ['Flags:'];
  for (const flag of helpFlags) {
    flagLines.push(
      `  ${(flag.usageLabel ?? '').padEnd(maxFlagLabel)}${flag.usageDescription ?? ''}`,
    );
  }

  return `${header}
${commandLines.join('\n')}

${flagLines.join('\n')}
`;
}

const USAGE_TEXT = renderUsageText();

export function buildUsageText(): string {
  return USAGE_TEXT;
}
