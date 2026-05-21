import type { SessionAction } from '../../daemon/types.ts';
import { AppError } from '../../utils/errors.ts';
import { convertLaunchApp, convertStopApp } from './device-actions.ts';
import {
  convertDoubleTapOn,
  convertExtendedWaitUntil,
  convertLongPressOn,
  convertPressKey,
  convertScroll,
  convertScrollUntilVisible,
  convertSwipe,
  convertTapOn,
  maestroSelector,
  readInputText,
} from './interactions.ts';
import {
  action,
  readTimeoutMs,
  requireAppId,
  requireStringValue,
  resolveMaestroString,
  unsupportedCommand,
} from './support.ts';
import { convertRepeat, convertRunFlow } from './flow-control.ts';
import { executeRunScript } from './run-script.ts';
import type {
  MaestroCommand,
  MaestroCommandMapperDeps,
  MaestroFlowConfig,
  MaestroParseContext,
} from './types.ts';

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
  openLink: ({ value, config, context, name }) => [convertOpenLink(value, config, context, name)],
  assertVisible: ({ value, context, name }) => [
    action('wait', [maestroSelector(value, name, [], context), '5000']),
  ],
  assertNotVisible: ({ value, context, name }) => [
    action('is', ['hidden', maestroSelector(value, name, [], context)]),
  ],
  extendedWaitUntil: ({ value, context }) => convertExtendedWaitUntil(value, context),
  takeScreenshot: ({ value, context, name }) => [
    action('screenshot', [resolveMaestroString(requireStringValue(name, value), context)]),
  ],
  scroll: ({ value }) => [convertScroll(value)],
  scrollUntilVisible: ({ value, context }) => convertScrollUntilVisible(value, context),
  swipe: ({ value }) => [convertSwipe(value)],
  hideKeyboard: () => [action('keyboard', ['dismiss'])],
  pressKey: ({ value }) => [convertPressKey(value)],
  back: () => [action('back')],
  waitForAnimationToEnd: ({ value }) => [action('wait', [String(readTimeoutMs(value, 250))])],
  stopApp: ({ value, config, context }) => [convertStopApp(value, config, context)],
  runScript: ({ value, context }) => {
    executeRunScript(value, context);
    return [];
  },
  runFlow: ({ value, config, context, deps }) =>
    convertRunFlow(value, config, context, deps, convertCommandList),
  repeat: ({ value, config, context, deps }) =>
    convertRepeat(value, config, context, deps, convertCommandList),
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

function convertOpenLink(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
  name: string,
): SessionAction {
  const url = resolveMaestroString(requireStringValue(name, value), context);
  if (context.platform === 'ios' && config.appId) {
    return action('open', [resolveMaestroString(requireAppId(config, name), context), url]);
  }
  return action('open', [url]);
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
