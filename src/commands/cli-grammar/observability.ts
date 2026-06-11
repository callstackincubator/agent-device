import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import type {
  LogsOptions,
  NetworkOptions,
  PerfOptions,
  RecordOptions,
} from '../../client-types.ts';
import { AppError } from '../../utils/errors.ts';
import { NETWORK_INCLUDE_MODES, type NetworkIncludeMode } from '../../contracts.ts';
import { parseStringMember } from '../../utils/string-enum.ts';
import { LOG_ACTION_VALUES, type LogAction } from '../log-command-contract.ts';
import {
  isPerfAction,
  isPerfArea,
  isPerfKind,
  PERF_ACTION_ERROR_MESSAGE,
  PERF_AREA_ERROR_MESSAGE,
  PERF_KIND_ERROR_MESSAGE,
  type PerfAction,
  type PerfArea,
  type PerfKind,
} from '../perf-command-contract.ts';
import {
  commonInputFromFlags,
  direct,
  optionalCliNumber,
  optionalNumber,
  optionalString,
  request,
} from './common.ts';
import type { CliReader, DaemonWriter } from './types.ts';

export const observabilityCliReaders = {
  perf: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readPerfPositionals(positionals),
    kind: readPerfKind(flags.kind),
    out: flags.out,
  }),
  logs: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readLogsAction(positionals[0]),
    message: positionals.slice(1).join(' ') || undefined,
    restart: flags.restart,
  }),
  network: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readNetworkAction(positionals[0]),
    limit: optionalCliNumber(positionals[1]),
    include: flags.networkInclude ?? readNetworkInclude(positionals[2]),
  }),
  record: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readStartStop(positionals[0], 'record'),
    path: positionals[1],
    fps: flags.fps,
    quality: flags.quality as RecordOptions['quality'],
    hideTouches: flags.hideTouches,
  }),
  trace: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readStartStop(positionals[0], 'trace'),
    path: positionals[1],
  }),
} satisfies Record<string, CliReader>;

export const observabilityDaemonWriters = {
  perf: direct(PUBLIC_COMMANDS.perf, (input) => perfPositionals(input as PerfOptions)),
  logs: direct(PUBLIC_COMMANDS.logs, (input) => logsPositionals(input as LogsOptions)),
  network: (input) =>
    request(PUBLIC_COMMANDS.network, networkPositionals(input as NetworkOptions), {
      ...input,
      networkInclude: input.include,
    }),
  record: direct(PUBLIC_COMMANDS.record, (input) => recordingPositionals(input as RecordOptions)),
  trace: direct(PUBLIC_COMMANDS.trace, (input) => recordingPositionals(input as RecordOptions)),
} satisfies Record<string, DaemonWriter>;

function perfPositionals(input: PerfOptions): string[] {
  const area = input.area ?? (input.action ? 'metrics' : undefined);
  return [...optionalString(area), ...optionalString(input.action)];
}

function readPerfPositionals(positionals: string[]): Pick<PerfOptions, 'area' | 'action'> {
  if (positionals[0] !== undefined && positionals[1] === undefined) {
    const action = readPerfAction(positionals[0], { allowUndefined: true });
    if (action) return { action };
  }
  return {
    area: readPerfArea(positionals[0]),
    action: readPerfAction(positionals[1]),
  };
}

function readPerfKind(value: string | undefined): PerfKind | undefined {
  if (value === undefined) return undefined;
  if (isPerfKind(value)) return value;
  throw new AppError('INVALID_ARGS', PERF_KIND_ERROR_MESSAGE);
}

function logsPositionals(input: { action?: string; message?: string }): string[] {
  return [input.action ?? 'path', ...optionalString(input.message)];
}

function networkPositionals(input: NetworkOptions): string[] {
  return [...(input.action ? [input.action] : []), ...optionalNumber(input.limit)];
}

function recordingPositionals(input: RecordOptions): string[] {
  return [input.action, ...optionalString(input.path)];
}

function readStartStop(value: string | undefined, command: string): 'start' | 'stop' {
  if (value === 'start' || value === 'stop') return value;
  throw new AppError('INVALID_ARGS', `${command} requires start|stop`);
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
    message: 'network include mode must be summary, headers, body, or all',
  });
}
