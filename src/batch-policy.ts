import { PUBLIC_COMMANDS } from './command-catalog.ts';
import { AppError } from './utils/errors.ts';

export const STRUCTURED_BATCH_COMMAND_NAMES = [
  PUBLIC_COMMANDS.devices,
  PUBLIC_COMMANDS.boot,
  PUBLIC_COMMANDS.shutdown,
  PUBLIC_COMMANDS.apps,
  PUBLIC_COMMANDS.open,
  PUBLIC_COMMANDS.close,
  PUBLIC_COMMANDS.install,
  PUBLIC_COMMANDS.reinstall,
  PUBLIC_COMMANDS.installFromSource,
  PUBLIC_COMMANDS.push,
  PUBLIC_COMMANDS.triggerAppEvent,
  PUBLIC_COMMANDS.snapshot,
  PUBLIC_COMMANDS.screenshot,
  PUBLIC_COMMANDS.diff,
  PUBLIC_COMMANDS.wait,
  PUBLIC_COMMANDS.alert,
  PUBLIC_COMMANDS.settings,
  PUBLIC_COMMANDS.click,
  PUBLIC_COMMANDS.press,
  PUBLIC_COMMANDS.longPress,
  PUBLIC_COMMANDS.swipe,
  PUBLIC_COMMANDS.focus,
  PUBLIC_COMMANDS.type,
  PUBLIC_COMMANDS.fill,
  PUBLIC_COMMANDS.scroll,
  PUBLIC_COMMANDS.get,
  PUBLIC_COMMANDS.gesture,
  PUBLIC_COMMANDS.is,
  PUBLIC_COMMANDS.find,
  PUBLIC_COMMANDS.perf,
  PUBLIC_COMMANDS.logs,
  PUBLIC_COMMANDS.network,
  PUBLIC_COMMANDS.record,
  PUBLIC_COMMANDS.trace,
  PUBLIC_COMMANDS.test,
  PUBLIC_COMMANDS.appState,
  PUBLIC_COMMANDS.back,
  PUBLIC_COMMANDS.home,
  PUBLIC_COMMANDS.rotate,
  PUBLIC_COMMANDS.appSwitcher,
  PUBLIC_COMMANDS.keyboard,
  PUBLIC_COMMANDS.clipboard,
  PUBLIC_COMMANDS.reactNative,
] as const;

export type StructuredBatchCommandName = (typeof STRUCTURED_BATCH_COMMAND_NAMES)[number];

export const BATCH_BLOCKED_COMMANDS: ReadonlySet<string> = new Set(['batch', 'replay']);

export const BATCH_DAEMON_STEP_KEYS = ['command', 'positionals', 'flags', 'runtime'] as const;

export const INHERITED_PARENT_FLAG_KEYS = [
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'verbose',
  'out',
] as const;

const structuredBatchCommandNames = new Set<string>(STRUCTURED_BATCH_COMMAND_NAMES);

function isStructuredBatchCommandName(command: string): command is StructuredBatchCommandName {
  return structuredBatchCommandNames.has(command);
}

export function normalizeBatchCommandName(command: unknown): string {
  return typeof command === 'string' ? command.trim().toLowerCase() : '';
}

export function readStructuredBatchCommandName(
  command: unknown,
  stepNumber: number,
): StructuredBatchCommandName {
  const normalized = normalizeBatchCommandName(command);
  if (isStructuredBatchCommandName(normalized)) return normalized;
  throw new AppError(
    'INVALID_ARGS',
    `Batch step ${stepNumber} command is not available through command batch: ${String(command)}`,
  );
}

export function assertBatchRuntimeCommandAllowed(command: string, stepNumber: number): void {
  if (BATCH_BLOCKED_COMMANDS.has(command)) {
    throw new AppError('INVALID_ARGS', `Batch step ${stepNumber} cannot run ${command}.`);
  }
}
