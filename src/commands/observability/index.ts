import type { LogsOptions, NetworkOptions, PerfOptions } from '../../client-types.ts';
import { NETWORK_INCLUDE_MODES, type NetworkIncludeMode } from '../../contracts.ts';
import { AppError } from '../../utils/errors.ts';
import { parseStringMember } from '../../utils/string-enum.ts';
import type { CommandSchemaOverride } from '../../utils/cli-command-schema-types.ts';
import {
  booleanField,
  enumField,
  integerField,
  requiredField,
  stringField,
} from '../command-input.ts';
import { defineExecutableCommand } from '../command-contract.ts';
import { defineFieldCommandMetadata } from '../field-command-contract.ts';
import { LOG_ACTION_VALUES, type LogAction } from './log-command-contract.ts';
import {
  isPerfAction,
  isPerfArea,
  isPerfKind,
  isPerfSubject,
  PERF_ACTION_ERROR_MESSAGE,
  PERF_ACTION_VALUES,
  PERF_AREA_ERROR_MESSAGE,
  PERF_AREA_VALUES,
  PERF_KIND_ERROR_MESSAGE,
  PERF_KIND_VALUES,
  PERF_SUBJECT_ERROR_MESSAGE,
  PERF_SUBJECT_VALUES,
  type PerfAction,
  type PerfArea,
  type PerfKind,
  type PerfSubject,
} from './perf-command-contract.ts';
import {
  commonInputFromFlags,
  direct,
  optionalCliNumber,
  optionalNumber,
  optionalString,
  request,
} from '../cli-grammar/common.ts';
import type { CliReader, DaemonWriter } from '../cli-grammar/types.ts';

const PERF_COMMAND_NAME = 'perf';
const LOGS_COMMAND_NAME = 'logs';
const NETWORK_COMMAND_NAME = 'network';
const DEBUG_COMMAND_NAME = 'debug';
const NETWORK_ACTION_VALUES = ['dump', 'log'] as const;
const DEBUG_ACTION_VALUES = ['symbols'] as const;

const perfCommandDescription = 'Show session performance, frame health, and memory diagnostics.';
const logsCommandDescription = 'Manage session app logs.';
const networkCommandDescription = 'Show recent HTTP traffic.';
const debugCommandDescription = 'Symbolicate crash artifacts with matching debug symbols.';

export const perfCommandMetadata = defineFieldCommandMetadata(
  PERF_COMMAND_NAME,
  perfCommandDescription,
  {
    area: enumField(PERF_AREA_VALUES),
    subject: enumField(PERF_SUBJECT_VALUES),
    action: enumField(PERF_ACTION_VALUES),
    kind: enumField(PERF_KIND_VALUES),
    template: stringField('xctrace template name, for example Time Profiler.'),
    out: stringField('Output artifact path.'),
    tracePath: stringField('Existing .trace path to report, defaults to the latest session trace.'),
  },
);

export const logsCommandMetadata = defineFieldCommandMetadata(
  LOGS_COMMAND_NAME,
  logsCommandDescription,
  {
    action: enumField(LOG_ACTION_VALUES),
    message: stringField(),
    restart: booleanField(),
  },
);

export const networkCommandMetadata = defineFieldCommandMetadata(
  NETWORK_COMMAND_NAME,
  networkCommandDescription,
  {
    action: enumField(NETWORK_ACTION_VALUES),
    limit: integerField(),
    include: enumField(NETWORK_INCLUDE_MODES),
  },
);

const debugCommandMetadata = defineFieldCommandMetadata(
  DEBUG_COMMAND_NAME,
  debugCommandDescription,
  {
    action: requiredField(enumField(DEBUG_ACTION_VALUES)),
    artifact: requiredField(stringField('Apple crash artifact path (.ips, .crash, or .log).')),
    dsym: stringField('Path to a matching .dSYM bundle.'),
    searchPath: stringField('Directory to scan for matching .dSYM bundles.'),
    out: stringField('Output path for the symbolicated artifact.'),
  },
);

export const observabilityCommandMetadata = [
  perfCommandMetadata,
  logsCommandMetadata,
  networkCommandMetadata,
  debugCommandMetadata,
] as const;

export const perfCommandDefinition = defineExecutableCommand(perfCommandMetadata, (client, input) =>
  client.observability.perf(input),
);

export const logsCommandDefinition = defineExecutableCommand(logsCommandMetadata, (client, input) =>
  client.observability.logs(input),
);

export const networkCommandDefinition = defineExecutableCommand(
  networkCommandMetadata,
  (client, input) => client.observability.network(input),
);

const debugCommandDefinition = defineExecutableCommand(debugCommandMetadata, (client, input) =>
  client.debug.symbols(input),
);

export const observabilityCommandDefinitions = [
  perfCommandDefinition,
  logsCommandDefinition,
  networkCommandDefinition,
  debugCommandDefinition,
] as const;

const perfCliSchema = {
  usageOverride:
    'perf [metrics|frames|memory] [sample|snapshot]\n  agent-device perf memory sample --json\n  agent-device perf memory snapshot [--kind android-hprof|memgraph] [--out <path>]\n  agent-device perf cpu profile start|stop|report --kind xctrace [--template <name>] --out <path>\n  agent-device perf trace start|stop --kind xctrace [--template <name>] --out <path>\n  agent-device perf cpu profile start|stop|report --kind simpleperf [--out <path>]\n  agent-device perf trace start|stop --kind perfetto [--out <path>]',
  listUsageOverride:
    'perf [metrics|frames|memory] | perf cpu profile start|stop|report | perf trace start|stop',
  helpDescription:
    'Show session performance metrics, focused frame/jank health, memory diagnostics artifacts, Apple xctrace artifacts, or Android native Simpleperf/Perfetto artifacts. Bare perf and metrics are aliases for perf metrics. Native perf output is agent evidence: compact state, artifact path, and size only; raw profiles/traces stay on disk.',
  summary: 'Show performance metrics or collect native perf artifacts',
  positionalArgs: ['area?', 'subjectOrAction?', 'action?'],
  allowedFlags: ['kind', 'perfTemplate', 'out'],
} as const satisfies CommandSchemaOverride;

const logsCliSchema = {
  usageOverride:
    'logs path | logs start | logs stop | logs clear [--restart] | logs doctor | logs mark [message...]',
  helpDescription: 'Session app log info, start/stop streaming, diagnostics, and markers',
  summary: 'Manage session app logs',
  positionalArgs: ['path|start|stop|clear|doctor|mark', 'message?'],
  allowsExtraPositionals: true,
  allowedFlags: ['restart'],
} as const satisfies CommandSchemaOverride;

const networkCliSchema = {
  usageOverride:
    'network dump [limit] [summary|headers|body|all] [--include summary|headers|body|all] | network log [limit] [summary|headers|body|all] [--include summary|headers|body|all]',
  helpDescription: 'Dump recent HTTP(s) traffic parsed from the session app log',
  summary: 'Show recent HTTP traffic',
  positionalArgs: ['dump|log', 'limit?', 'include?'],
  allowedFlags: ['networkInclude'],
} as const satisfies CommandSchemaOverride;

const debugCliSchema = {
  usageOverride:
    'debug symbols --artifact <crash.ips|crash.log> (--dsym <App.dSYM> | --search-path <dir>) [--out <symbolicated>]',
  listUsageOverride: 'debug symbols --artifact <path> --dsym <App.dSYM>',
  helpDescription:
    'Symbolicate Apple crash artifacts with matching dSYM UUIDs. This debug namespace is intentionally narrow: use logs for app logs, network for HTTP evidence, perf for performance samples, record/trace for media and traces, and react-devtools for React Native profiles.',
  summary: 'Symbolicate Apple crash artifacts',
  positionalArgs: ['symbols'],
  allowedFlags: ['artifact', 'dsym', 'searchPath', 'out'],
} as const satisfies CommandSchemaOverride;

export const observabilityCliSchemas = {
  [PERF_COMMAND_NAME]: perfCliSchema,
  [LOGS_COMMAND_NAME]: logsCliSchema,
  [NETWORK_COMMAND_NAME]: networkCliSchema,
  [DEBUG_COMMAND_NAME]: debugCliSchema,
} as const satisfies Record<string, CommandSchemaOverride>;

export const perfCliReader: CliReader = (positionals, flags) => ({
  ...commonInputFromFlags(flags),
  ...readPerfPositionals(positionals, {
    kind: readPerfKindFlag(flags.kind),
    template: flags.perfTemplate,
    out: flags.out,
  }),
});

export const logsCliReader: CliReader = (positionals, flags) => ({
  ...commonInputFromFlags(flags),
  action: readLogsAction(positionals[0]),
  message: positionals.slice(1).join(' ') || undefined,
  restart: flags.restart,
});

export const networkCliReader: CliReader = (positionals, flags) => ({
  ...commonInputFromFlags(flags),
  action: readNetworkAction(positionals[0]),
  limit: optionalCliNumber(positionals[1]),
  include: flags.networkInclude ?? readNetworkInclude(positionals[2]),
});

const debugCliReader: CliReader = (positionals, flags) => ({
  ...commonInputFromFlags(flags),
  action: readDebugAction(positionals[0]),
  artifact: flags.artifact,
  dsym: flags.dsym,
  searchPath: flags.searchPath,
  out: flags.out,
});

export const observabilityCliReaders = {
  perf: perfCliReader,
  logs: logsCliReader,
  network: networkCliReader,
  debug: debugCliReader,
} satisfies Record<string, CliReader>;

export const perfDaemonWriter: DaemonWriter = direct(PERF_COMMAND_NAME, (input) =>
  perfPositionals(input as PerfOptions),
);

export const logsDaemonWriter: DaemonWriter = direct(LOGS_COMMAND_NAME, (input) =>
  logsPositionals(input as LogsOptions),
);

export const networkDaemonWriter: DaemonWriter = (input) =>
  request(NETWORK_COMMAND_NAME, networkPositionals(input as NetworkOptions), {
    ...input,
    networkInclude: input.include,
  });

export const observabilityDaemonWriters = {
  perf: perfDaemonWriter,
  logs: logsDaemonWriter,
  network: networkDaemonWriter,
} satisfies Record<string, DaemonWriter>;

function perfPositionals(input: PerfOptions): string[] {
  const area = input.area ?? (input.action ? 'metrics' : undefined);
  if (area === 'cpu') {
    return nativePerfPositionals(
      [
        ...optionalString(area),
        ...optionalString(input.subject),
        ...optionalString(input.action),
        ...optionalString(input.kind),
      ],
      input,
    );
  }
  if (area === 'trace') {
    return nativePerfPositionals(
      [...optionalString(area), ...optionalString(input.action), ...optionalString(input.kind)],
      input,
    );
  }
  return [...optionalString(area), ...optionalString(input.action)];
}

function nativePerfPositionals(base: string[], input: PerfOptions): string[] {
  const positionals = [...base];
  if (input.template || input.out || input.tracePath) {
    positionals.push(input.template ?? '');
  }
  if (input.out || input.tracePath) {
    positionals.push(input.out ?? '');
  }
  if (input.tracePath) {
    positionals.push(input.tracePath);
  }
  return positionals;
}

function readPerfPositionals(
  positionals: string[],
  flags: Pick<PerfOptions, 'kind' | 'template' | 'out'> = {},
): Pick<PerfOptions, 'area' | 'subject' | 'action' | 'kind' | 'template' | 'out'> {
  if (positionals[0] !== undefined && positionals[1] === undefined) {
    const action = readPerfAction(positionals[0], { allowUndefined: true });
    if (action) return { action, kind: readPerfKind(flags.kind), out: flags.out };
  }
  const area = readPerfArea(positionals[0]);
  if (area === 'cpu') {
    return {
      area,
      subject: readPerfSubject(positionals[1]),
      action: readPerfAction(positionals[2]),
      kind: readPerfKind(flags.kind),
      template: flags.template,
      out: flags.out,
    };
  }
  if (area === 'trace') {
    return {
      area,
      action: readPerfAction(positionals[1]),
      kind: readPerfKind(flags.kind),
      template: flags.template,
      out: flags.out,
    };
  }
  return {
    area,
    action: readPerfAction(positionals[1]),
    kind: readPerfKind(flags.kind),
    out: flags.out,
  };
}

function logsPositionals(input: { action?: string; message?: string }): string[] {
  return [input.action ?? 'path', ...optionalString(input.message)];
}

function networkPositionals(input: NetworkOptions): string[] {
  return [...(input.action ? [input.action] : []), ...optionalNumber(input.limit)];
}

function readPerfArea(value: string | undefined): PerfArea | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (isPerfArea(normalized)) return normalized;
  throw new AppError('INVALID_ARGS', PERF_AREA_ERROR_MESSAGE);
}

function readPerfAction(
  value: string | undefined,
  options: { allowUndefined?: boolean } = {},
): PerfAction | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (isPerfAction(normalized)) return normalized;
  if (options.allowUndefined) return undefined;
  throw new AppError('INVALID_ARGS', PERF_ACTION_ERROR_MESSAGE);
}

function readPerfSubject(value: string | undefined): PerfSubject {
  const normalized = value?.toLowerCase();
  if (normalized !== undefined && isPerfSubject(normalized)) return normalized;
  throw new AppError('INVALID_ARGS', PERF_SUBJECT_ERROR_MESSAGE);
}

function readPerfKind(value: string | undefined): PerfKind | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (isPerfKind(normalized)) return normalized;
  throw new AppError('INVALID_ARGS', PERF_KIND_ERROR_MESSAGE);
}

function readPerfKindFlag(value: unknown): PerfKind | undefined {
  return typeof value === 'string' ? readPerfKind(value) : undefined;
}

function readLogsAction(value: string | undefined): LogAction | undefined {
  if (value === undefined) return undefined;
  return parseStringMember(LOG_ACTION_VALUES, value, {
    message: 'logs requires path, start, stop, doctor, mark, or clear',
  });
}

function readNetworkAction(value: string | undefined): 'dump' | 'log' | undefined {
  if (value === undefined) return undefined;
  if (value === 'dump' || value === 'log') return value;
  throw new AppError('INVALID_ARGS', 'network requires dump or log');
}

function readNetworkInclude(value: string | undefined): NetworkIncludeMode | undefined {
  if (value === undefined) return undefined;
  return parseStringMember(NETWORK_INCLUDE_MODES, value, {
    message: 'network include must be summary, headers, body, or all',
  });
}

function readDebugAction(value: string | undefined): 'symbols' {
  if (value === 'symbols') return value;
  throw new AppError(
    'INVALID_ARGS',
    'debug supports only symbols; use logs, network, perf, record, trace, or react-devtools for other diagnostics',
  );
}
