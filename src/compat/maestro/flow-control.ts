import type { CommandFlags } from '../../core/dispatch.ts';
import type { SessionAction } from '../../daemon/types.ts';
import { AppError } from '../../utils/errors.ts';
import { maestroSelector } from './interactions.ts';
import { MAESTRO_RUNTIME_COMMAND } from './runtime-commands.ts';
import {
  action,
  assertOnlyKeys,
  isPlainRecord,
  normalizeCommandList,
  normalizePlatformValue,
  readEnvMap,
  resolveMaestroString,
  unsupportedMaestroSyntax,
} from './support.ts';
import type {
  MaestroCommand,
  MaestroCommandMapperDeps,
  MaestroFlowConfig,
  MaestroParseContext,
} from './types.ts';

// repeat.times is expanded at parse time for deterministic replay traces. Keep
// a guardrail until repeat can execute as a runtime loop without materializing
// every child action.
const MAX_REPEAT_EXPANSIONS = 1000;

type ConvertCommandList = (
  commands: MaestroCommand[],
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
) => SessionAction[];

export function convertRunFlow(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
  convertCommandList: ConvertCommandList,
): SessionAction[] {
  if (typeof value === 'string') {
    return deps.parseRunFlowFile(resolveMaestroString(value, context), context).actions;
  }
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'runFlow expects a file path string or map.');
  }
  assertOnlyKeys(value, 'runFlow', ['file', 'commands', 'env', 'when', 'label']);
  const condition = readRunFlowCondition(value.when, context);
  if (!condition.shouldRun) return [];

  const runContext = {
    ...context,
    env: { ...context.env, ...readEnvMap(value.env, 'runFlow.env'), ...context.envOverrides },
  };
  const actions = readRunFlowActions(value, config, runContext, deps, convertCommandList);
  return wrapRunFlowCondition(actions, condition);
}

export function convertRepeat(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
  convertCommandList: ConvertCommandList,
): SessionAction[] {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'repeat expects a map.');
  }
  assertOnlyKeys(value, 'repeat', ['times', 'commands', 'while']);
  if (value.while !== undefined) {
    throw unsupportedMaestroSyntax(
      'Maestro repeat.while is not supported yet. Only deterministic repeat.times is supported.',
    );
  }
  const times = readRepeatTimes(value.times, context);
  if (!Array.isArray(value.commands)) {
    throw new AppError('INVALID_ARGS', 'repeat requires a commands list.');
  }
  if (times > MAX_REPEAT_EXPANSIONS) {
    throw new AppError(
      'INVALID_ARGS',
      `repeat.times must be <= ${MAX_REPEAT_EXPANSIONS} for deterministic replay expansion.`,
    );
  }
  const commands = normalizeCommandList(value.commands);
  return Array.from({ length: times }).flatMap(() =>
    convertCommandList(commands, config, context, deps),
  );
}

function readRunFlowActions(
  value: Record<string, unknown>,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
  convertCommandList: ConvertCommandList,
): SessionAction[] {
  if (typeof value.file === 'string') {
    return deps.parseRunFlowFile(resolveMaestroString(value.file, context), context).actions;
  }
  if (Array.isArray(value.commands)) {
    return convertCommandList(normalizeCommandList(value.commands), config, context, deps);
  }
  throw new AppError('INVALID_ARGS', 'runFlow map requires either file or commands.');
}

type RunFlowCondition = {
  shouldRun: boolean;
  visibleSelector?: string;
  notVisibleSelector?: string;
};

function readRunFlowCondition(value: unknown, context: MaestroParseContext): RunFlowCondition {
  if (value === undefined || value === null) return { shouldRun: true };
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'runFlow.when expects a map.');
  }
  assertOnlyKeys(value, 'runFlow.when', ['platform', 'visible', 'notVisible', 'true']);
  rejectUnsupportedCondition(value, 'true', 'when.true');
  if (value.platform !== undefined) {
    const platform = normalizePlatformValue(value.platform, 'runFlow.when.platform');
    if (!context.platform) {
      throw new AppError(
        'INVALID_ARGS',
        'Maestro runFlow.when.platform requires replay to be run with --platform ios|android.',
      );
    }
    if (platform !== context.platform) return { shouldRun: false };
  }
  return {
    shouldRun: true,
    ...(value.visible !== undefined
      ? { visibleSelector: maestroSelector(value.visible, 'runFlow.when.visible', [], context) }
      : {}),
    ...(value.notVisible !== undefined
      ? {
          notVisibleSelector: maestroSelector(
            value.notVisible,
            'runFlow.when.notVisible',
            [],
            context,
          ),
        }
      : {}),
  };
}

function wrapRunFlowCondition(
  actions: SessionAction[],
  condition: RunFlowCondition,
): SessionAction[] {
  if (!condition.visibleSelector && !condition.notVisibleSelector) return actions;
  if (condition.visibleSelector && condition.notVisibleSelector) {
    throw unsupportedMaestroSyntax(
      'Maestro runFlow.when cannot combine visible and notVisible yet.',
    );
  }
  return [
    action(
      MAESTRO_RUNTIME_COMMAND.runFlowWhen,
      condition.visibleSelector
        ? ['visible', condition.visibleSelector]
        : ['notVisible', condition.notVisibleSelector ?? ''],
      { batchSteps: actions.map(sessionActionToBatchStep) },
    ),
  ];
}

function sessionActionToBatchStep(
  entry: SessionAction,
): NonNullable<CommandFlags['batchSteps']>[number] {
  return {
    command: entry.command,
    positionals: entry.positionals,
    flags: entry.flags,
    ...(entry.runtime !== undefined ? { runtime: entry.runtime } : {}),
  };
}

function readRepeatTimes(value: unknown, context: MaestroParseContext): number {
  const resolved = typeof value === 'string' ? resolveMaestroString(value, context) : value;
  const numeric =
    typeof resolved === 'number'
      ? resolved
      : typeof resolved === 'string' && /^\d+$/.test(resolved)
        ? Number(resolved)
        : undefined;
  if (numeric === undefined || !Number.isInteger(numeric) || numeric < 0) {
    throw new AppError(
      'INVALID_ARGS',
      'repeat.times must be a non-negative integer or ${VAR} resolving to one.',
    );
  }
  return numeric;
}

function rejectUnsupportedCondition(
  value: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (value[key] !== undefined) {
    throw unsupportedMaestroSyntax(`Maestro ${label} is not supported yet.`);
  }
}
