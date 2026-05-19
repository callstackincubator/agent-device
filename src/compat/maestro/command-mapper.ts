import type { SessionAction } from '../../daemon/types.ts';
import { AppError } from '../../utils/errors.ts';
import {
  convertAssertTrue,
  convertKillApp,
  convertLaunchApp,
  convertSetAirplaneMode,
  convertSetLocation,
  convertSetOrientation,
  convertSetPermissions,
  convertStartRecording,
  convertStopApp,
  convertStopRecording,
} from './device-actions.ts';
import {
  convertDoubleTapOn,
  convertExtendedWaitUntil,
  convertLongPressOn,
  convertPressKey,
  convertScroll,
  convertSwipe,
  convertTapOn,
  maestroSelector,
  readInputText,
} from './interactions.ts';
import {
  action,
  assertOnlyKeys,
  isPlainRecord,
  normalizeCommandList,
  normalizePlatformValue,
  readEnvMap,
  readTimeoutMs,
  requireStringValue,
  resolveMaestroString,
  unsupportedCommand,
  unsupportedMaestroSyntax,
} from './support.ts';
import type {
  MaestroCommand,
  MaestroCommandMapperDeps,
  MaestroFlowConfig,
  MaestroParseContext,
} from './types.ts';

const MAX_REPEAT_EXPANSIONS = 100;
type MaestroCommandHandler = (params: {
  value: unknown;
  config: MaestroFlowConfig;
  context: MaestroParseContext;
  deps: MaestroCommandMapperDeps;
  name: string;
}) => SessionAction[];

const MAP_COMMAND_HANDLERS: Record<string, MaestroCommandHandler> = {
  launchApp: ({ value, config, context }) => [convertLaunchApp(value, config, context)],
  tapOn: ({ value, context }) => [convertTapOn(value, context)],
  doubleTapOn: ({ value, context }) => [convertDoubleTapOn(value, context)],
  longPressOn: ({ value, context }) => [convertLongPressOn(value, context)],
  inputText: ({ value, context }) => [
    action('type', [resolveMaestroString(readInputText(value), context)]),
  ],
  pasteText: ({ value, context, name }) => [
    action('type', [resolveMaestroString(requireStringValue(name, value), context)]),
  ],
  openLink: ({ value, context, name }) => [
    action('open', [resolveMaestroString(requireStringValue(name, value), context)]),
  ],
  assertVisible: ({ value, context, name }) => [
    action('wait', [maestroSelector(value, name, [], context), '5000']),
  ],
  assertNotVisible: ({ value, context, name }) => [
    action('is', ['hidden', maestroSelector(value, name, [], context)]),
  ],
  assertTrue: ({ value, context }) => convertAssertTrue(value, context),
  extendedWaitUntil: ({ value, context }) => convertExtendedWaitUntil(value, context),
  takeScreenshot: ({ value, context, name }) => [
    action('screenshot', [resolveMaestroString(requireStringValue(name, value), context)]),
  ],
  scroll: ({ value }) => [convertScroll(value)],
  swipe: ({ value }) => [convertSwipe(value)],
  hideKeyboard: () => [action('keyboard', ['dismiss'])],
  pressKey: ({ value }) => [convertPressKey(value)],
  back: () => [action('back')],
  waitForAnimationToEnd: ({ value }) => [action('wait', [String(readTimeoutMs(value, 250))])],
  stopApp: ({ value, config, context }) => [convertStopApp(value, config, context)],
  killApp: ({ value, config, context }) => [convertKillApp(value, config, context)],
  setAirplaneMode: ({ value, context }) => [convertSetAirplaneMode(value, context)],
  setLocation: ({ value, context }) => [convertSetLocation(value, context)],
  setOrientation: ({ value, context }) => [convertSetOrientation(value, context)],
  setPermissions: ({ value, context }) => convertSetPermissions(value, context),
  startRecording: ({ value, context }) => [convertStartRecording(value, context)],
  stopRecording: ({ value }) => [convertStopRecording(value)],
  runFlow: ({ value, config, context, deps }) => convertRunFlow(value, config, context, deps),
  repeat: ({ value, config, context, deps }) => convertRepeat(value, config, context, deps),
};

const SCALAR_COMMAND_HANDLERS: Record<
  string,
  (config: MaestroFlowConfig, context: MaestroParseContext) => SessionAction[]
> = {
  launchApp: (config, context) => [convertLaunchApp(undefined, config, context)],
  scroll: () => [action('scroll', ['down'])],
  hideKeyboard: () => [action('keyboard', ['dismiss'])],
  back: () => [action('back')],
  waitForAnimationToEnd: () => [action('wait', ['250'])],
  stopApp: (config, context) => [convertStopApp(undefined, config, context)],
  killApp: (config, context) => [convertKillApp(undefined, config, context)],
  startRecording: () => [action('record', ['start'])],
  stopRecording: () => [action('record', ['stop'])],
};

export function convertMaestroCommandWithLine(
  command: MaestroCommand,
  config: MaestroFlowConfig,
  line: number,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
): SessionAction[] {
  try {
    return convertMaestroCommand(command, config, context, deps);
  } catch (error) {
    if (error instanceof AppError && !/\bline \d+\b/.test(error.message)) {
      throw new AppError(error.code, `${error.message} (line ${line})`, error.details);
    }
    throw error;
  }
}

function convertMaestroCommand(
  command: MaestroCommand,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
): SessionAction[] {
  if (typeof command === 'string') return convertScalarCommand(command, config, context);

  const entries = Object.entries(command);
  if (entries.length !== 1) {
    throw new AppError('INVALID_ARGS', 'Maestro command maps must contain exactly one command.');
  }

  const [name, value] = entries[0] as [string, unknown];
  const handler = MAP_COMMAND_HANDLERS[name];
  if (!handler) return unsupportedCommand(name);
  return handler({ value, config, context, deps, name });
}

function convertScalarCommand(
  command: string,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
): SessionAction[] {
  const handler = SCALAR_COMMAND_HANDLERS[command];
  if (!handler) return unsupportedCommand(command);
  return handler(config, context);
}

function convertRunFlow(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
): SessionAction[] {
  if (typeof value === 'string') {
    return deps.parseRunFlowFile(resolveMaestroString(value, context), context).actions;
  }
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'runFlow expects a file path string or map.');
  }
  assertOnlyKeys(value, 'runFlow', ['file', 'commands', 'env', 'when', 'label']);
  if (!shouldRunFlow(value.when, context)) return [];

  const runContext = {
    ...context,
    env: { ...context.env, ...readEnvMap(value.env, 'runFlow.env'), ...context.envOverrides },
  };
  if (typeof value.file === 'string') {
    return deps.parseRunFlowFile(resolveMaestroString(value.file, runContext), runContext).actions;
  }
  if (Array.isArray(value.commands)) {
    return convertCommandList(normalizeCommandList(value.commands), config, runContext, deps);
  }
  throw new AppError('INVALID_ARGS', 'runFlow map requires either file or commands.');
}

function convertRepeat(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
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

function convertCommandList(
  commands: MaestroCommand[],
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  deps: MaestroCommandMapperDeps,
): SessionAction[] {
  return commands.flatMap((command, index) =>
    convertMaestroCommandWithLine(command, config, index + 1, context, deps),
  );
}

function shouldRunFlow(value: unknown, context: MaestroParseContext): boolean {
  if (value === undefined || value === null) return true;
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'runFlow.when expects a map.');
  }
  assertOnlyKeys(value, 'runFlow.when', ['platform', 'visible', 'notVisible', 'true']);
  rejectUnsupportedCondition(value, 'visible', 'when.visible');
  rejectUnsupportedCondition(value, 'notVisible', 'when.notVisible');
  rejectUnsupportedCondition(value, 'true', 'when.true');
  if (value.platform === undefined) return true;
  const platform = normalizePlatformValue(value.platform, 'runFlow.when.platform');
  if (!context.platform) {
    throw new AppError(
      'INVALID_ARGS',
      'Maestro runFlow.when.platform requires replay to be run with --platform ios|android.',
    );
  }
  return platform === context.platform;
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
