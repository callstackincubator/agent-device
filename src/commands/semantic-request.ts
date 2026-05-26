import { INTERNAL_COMMANDS, PUBLIC_COMMANDS } from '../command-catalog.ts';
import { buildFlags } from '../client-normalizers.ts';
import type {
  AlertCommandOptions,
  AppPushOptions,
  AppTriggerEventOptions,
  BatchStep,
  CaptureScreenshotOptions,
  ClipboardCommandOptions,
  ElementTarget,
  FlingOptions,
  FillOptions,
  FindOptions,
  InteractionTarget,
  InternalRequestOptions,
  IsOptions,
  LogsOptions,
  LongPressOptions,
  NetworkOptions,
  RecordOptions,
  ReplayRunOptions,
  RotateGestureOptions,
  SettingsUpdateOptions,
  TypeTextOptions,
  WaitCommandOptions,
} from '../client-types.ts';
import { tryParseSelectorChain } from '../daemon/selectors.ts';
import { AppError } from '../utils/errors.ts';
import { screenshotFlagsFromOptions } from './capture-screenshot-options.ts';

export type SemanticDaemonCommand =
  | 'devices'
  | 'boot'
  | 'apps'
  | 'open'
  | 'close'
  | 'install'
  | 'reinstall'
  | 'install-from-source'
  | 'push'
  | 'trigger-app-event'
  | 'snapshot'
  | 'screenshot'
  | 'diff'
  | 'wait'
  | 'alert'
  | 'appstate'
  | 'back'
  | 'home'
  | 'rotate'
  | 'app-switcher'
  | 'keyboard'
  | 'clipboard'
  | 'react-native'
  | 'click'
  | 'press'
  | 'longpress'
  | 'swipe'
  | 'gesture'
  | 'gesture-pan'
  | 'gesture-fling'
  | 'gesture-pinch'
  | 'gesture-rotate'
  | 'gesture-transform'
  | 'focus'
  | 'type'
  | 'fill'
  | 'scroll'
  | 'get'
  | 'is'
  | 'find'
  | 'replay'
  | 'test'
  | 'batch'
  | 'perf'
  | 'logs'
  | 'network'
  | 'record'
  | 'trace'
  | 'settings';

export type SemanticDaemonRequest = {
  command: string;
  positionals: string[];
  options: InternalRequestOptions;
};

type SemanticRequestInput = InternalRequestOptions & Record<string, any>;

export function prepareSemanticBatchStep(
  command: SemanticDaemonCommand,
  input: SemanticRequestInput,
): BatchStep {
  const request = prepareSemanticDaemonRequest(command, input);
  return {
    command: request.command,
    positionals: request.positionals,
    flags: buildFlags(request.options),
    runtime: request.options.runtime,
  };
}

export function prepareSemanticDaemonRequest(
  command: SemanticDaemonCommand,
  input: SemanticRequestInput,
): SemanticDaemonRequest {
  switch (command) {
    case 'devices':
      return request(PUBLIC_COMMANDS.devices, [], input);
    case 'boot':
      return request(PUBLIC_COMMANDS.boot, [], input);
    case 'apps':
      return request(PUBLIC_COMMANDS.apps, [], input);
    case 'open':
      return request(PUBLIC_COMMANDS.open, openPositionals(input), input);
    case 'close':
      return request(PUBLIC_COMMANDS.close, optionalString(input.app), input);
    case 'install':
      return request(PUBLIC_COMMANDS.install, requiredPair(input.app, input.appPath), input);
    case 'reinstall':
      return request(PUBLIC_COMMANDS.reinstall, requiredPair(input.app, input.appPath), input);
    case 'install-from-source':
      return request(INTERNAL_COMMANDS.installSource, [], {
        ...input,
        installSource: input.source,
        retainMaterializedPaths: input.retainPaths,
        materializedPathRetentionMs: input.retentionMs,
      });
    case 'push':
      return request(PUBLIC_COMMANDS.push, pushPositionals(input as AppPushOptions), input);
    case 'trigger-app-event':
      return request(
        PUBLIC_COMMANDS.triggerAppEvent,
        triggerEventPositionals(input as AppTriggerEventOptions),
        input,
      );
    case 'snapshot':
      return request(PUBLIC_COMMANDS.snapshot, [], input);
    case 'screenshot':
      return request(PUBLIC_COMMANDS.screenshot, optionalString(input.path), {
        ...input,
        ...screenshotFlagsFromOptions(input as CaptureScreenshotOptions),
      });
    case 'diff':
      return request(PUBLIC_COMMANDS.diff, [required(input.kind, 'diff requires kind')], input);
    case 'wait':
      return request(PUBLIC_COMMANDS.wait, waitPositionals(input as WaitCommandOptions), input);
    case 'alert':
      return request(PUBLIC_COMMANDS.alert, alertPositionals(input as AlertCommandOptions), input);
    case 'appstate':
      return request(PUBLIC_COMMANDS.appState, [], input);
    case 'back':
      return request(PUBLIC_COMMANDS.back, [], { ...input, backMode: input.mode });
    case 'home':
      return request(PUBLIC_COMMANDS.home, [], input);
    case 'rotate':
      return request(
        PUBLIC_COMMANDS.rotate,
        [required(input.orientation, 'rotate requires orientation')],
        input,
      );
    case 'app-switcher':
      return request(PUBLIC_COMMANDS.appSwitcher, [], input);
    case 'keyboard':
      return request(PUBLIC_COMMANDS.keyboard, optionalString(input.action), input);
    case 'clipboard':
      return request(
        PUBLIC_COMMANDS.clipboard,
        clipboardPositionals(input as ClipboardCommandOptions),
        input,
      );
    case 'react-native':
      return request(
        PUBLIC_COMMANDS.reactNative,
        [required(input.action, 'react-native requires action')],
        input,
      );
    case 'click':
      return request(
        PUBLIC_COMMANDS.click,
        interactionTargetPositionals(input as InteractionTarget),
        {
          ...input,
          clickButton: input.button,
        },
      );
    case 'press':
      return request(
        PUBLIC_COMMANDS.press,
        interactionTargetPositionals(input as InteractionTarget),
        input,
      );
    case 'longpress':
      return request(
        PUBLIC_COMMANDS.longPress,
        longPressPositionals(input as LongPressOptions),
        input,
      );
    case 'swipe':
      return request(PUBLIC_COMMANDS.swipe, swipePositionals(input), input);
    case 'gesture':
      return request(PUBLIC_COMMANDS.gesture, semanticGesturePositionals(input), input);
    case 'gesture-pan':
      return request(PUBLIC_COMMANDS.gesture, panPositionals(input), input);
    case 'gesture-fling':
      return request(PUBLIC_COMMANDS.gesture, flingPositionals(input as FlingOptions), input);
    case 'gesture-pinch':
      return request(PUBLIC_COMMANDS.gesture, pinchPositionals(input), input);
    case 'gesture-rotate':
      return request(PUBLIC_COMMANDS.gesture, rotateGesturePositionals(input), input);
    case 'gesture-transform':
      return request(PUBLIC_COMMANDS.gesture, transformPositionals(input), input);
    case 'focus':
      return request(PUBLIC_COMMANDS.focus, [String(input.x), String(input.y)], input);
    case 'type':
      return request(PUBLIC_COMMANDS.type, typePositionals(input as TypeTextOptions), input);
    case 'fill':
      return request(PUBLIC_COMMANDS.fill, fillPositionals(input as FillOptions), input);
    case 'scroll':
      return request(
        PUBLIC_COMMANDS.scroll,
        [required(input.direction, 'scroll requires direction'), ...optionalNumber(input.amount)],
        input,
      );
    case 'get':
      return request(
        PUBLIC_COMMANDS.get,
        [
          required(input.format, 'get requires format'),
          ...elementTargetPositionals(input as ElementTarget),
        ],
        input,
      );
    case 'is':
      return request(PUBLIC_COMMANDS.is, isPositionals(input as IsOptions), input);
    case 'find':
      return request(PUBLIC_COMMANDS.find, findPositionals(input as FindOptions), {
        ...input,
        findFirst: input.first,
        findLast: input.last,
      });
    case 'replay':
      return request(PUBLIC_COMMANDS.replay, [required(input.path, 'replay requires path')], {
        ...input,
        replayUpdate: input.update,
        replayBackend:
          input.backend ?? ((input as ReplayRunOptions).maestro === true ? 'maestro' : undefined),
        replayEnv: input.env,
        replayShellEnv: collectReplayClientShellEnv(process.env),
      });
    case 'test':
      return request(PUBLIC_COMMANDS.test, input.paths ?? [], {
        ...input,
        replayUpdate: input.update,
        replayEnv: input.env,
        replayShellEnv: collectReplayClientShellEnv(process.env),
      });
    case 'batch':
      return request(PUBLIC_COMMANDS.batch, [], {
        ...input,
        batchSteps: input.steps,
        batchOnError: input.onError,
        batchMaxSteps: input.maxSteps,
      });
    case 'perf':
      return request(PUBLIC_COMMANDS.perf, [], input);
    case 'logs':
      return request(PUBLIC_COMMANDS.logs, logsPositionals(input as LogsOptions), input);
    case 'network':
      return request(PUBLIC_COMMANDS.network, networkPositionals(input as NetworkOptions), {
        ...input,
        networkInclude: input.include,
      });
    case 'record':
      return request(PUBLIC_COMMANDS.record, recordingPositionals(input as RecordOptions), input);
    case 'trace':
      return request(PUBLIC_COMMANDS.trace, recordingPositionals(input as RecordOptions), input);
    case 'settings':
      return request(
        PUBLIC_COMMANDS.settings,
        settingsPositionals(input as SettingsUpdateOptions),
        input,
      );
  }
}

function request(
  command: string,
  positionals: string[],
  options: SemanticRequestInput,
): SemanticDaemonRequest {
  return { command, positionals, options: normalizeCommonRequestOptions(options) };
}

function normalizeCommonRequestOptions(options: SemanticRequestInput): SemanticRequestInput {
  return options.deviceTarget !== undefined && options.target === undefined
    ? { ...options, target: options.deviceTarget }
    : options;
}

function waitPositionals(options: WaitCommandOptions): string[] {
  const targets = [
    options.durationMs !== undefined ? 'durationMs' : undefined,
    options.text !== undefined ? 'text' : undefined,
    options.ref !== undefined ? 'ref' : undefined,
    options.selector !== undefined ? 'selector' : undefined,
  ].filter(Boolean);
  if (targets.length !== 1) {
    throw new AppError(
      'INVALID_ARGS',
      'wait command requires exactly one of durationMs, text, ref, or selector.',
    );
  }
  if (options.durationMs !== undefined) return [String(options.durationMs)];
  const timeout = optionalNumber(options.timeoutMs);
  if (options.text !== undefined) return ['text', options.text, ...timeout];
  if (options.ref !== undefined) return [options.ref, ...timeout];
  const selector = options.selector!;
  if (!tryParseSelectorChain(selector)) {
    throw new AppError('INVALID_ARGS', `Invalid wait selector: ${selector}`);
  }
  return [selector, ...timeout];
}

function openPositionals(input: SemanticRequestInput): string[] {
  if (!input.app) return [];
  return input.url ? [input.app, input.url] : [input.app];
}

function requiredPair(first: unknown, second: unknown): string[] {
  return [
    required(first, 'missing first positional'),
    required(second, 'missing second positional'),
  ];
}

function pushPositionals(input: AppPushOptions): string[] {
  return [
    input.app,
    typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload),
  ];
}

function triggerEventPositionals(input: AppTriggerEventOptions): string[] {
  return [input.event, ...(input.payload ? [JSON.stringify(input.payload)] : [])];
}

function alertPositionals(input: AlertCommandOptions): string[] {
  return [input.action ?? 'get', ...optionalNumber(input.timeoutMs)];
}

function clipboardPositionals(input: ClipboardCommandOptions): string[] {
  return input.action === 'read' ? ['read'] : ['write', input.text];
}

function interactionTargetPositionals(input: InteractionTarget): string[] {
  if (input.ref !== undefined) return [input.ref, ...optionalString(input.label)];
  if (input.selector !== undefined) return [input.selector];
  return [String(input.x), String(input.y)];
}

function elementTargetPositionals(input: ElementTarget): string[] {
  if (input.ref !== undefined) return [input.ref, ...optionalString(input.label)];
  return [input.selector];
}

function longPressPositionals(input: LongPressOptions): string[] {
  return [...interactionTargetPositionals(input), ...optionalNumber(input.durationMs)];
}

function typePositionals(input: TypeTextOptions): string[] {
  return [input.text];
}

function fillPositionals(input: FillOptions): string[] {
  return [...interactionTargetPositionals(input), input.text];
}

function swipePositionals(input: SemanticRequestInput): string[] {
  return [
    String(input.from?.x),
    String(input.from?.y),
    String(input.to?.x),
    String(input.to?.y),
    ...optionalNumber(input.durationMs),
  ];
}

function semanticGesturePositionals(input: SemanticRequestInput): string[] {
  switch (input.kind) {
    case 'pan':
      return [
        'pan',
        String(input.origin?.x),
        String(input.origin?.y),
        String(input.delta?.x),
        String(input.delta?.y),
        ...optionalNumber(input.durationMs),
      ];
    case 'fling':
      return [
        'fling',
        required(input.direction, 'gesture fling requires direction'),
        String(input.origin?.x),
        String(input.origin?.y),
        ...optionalNumber(input.distance),
        ...optionalNumber(input.durationMs),
      ];
    case 'pinch':
      return [
        'pinch',
        String(input.scale),
        ...optionalNumber(input.origin?.x),
        ...optionalNumber(input.origin?.y),
      ];
    case 'rotate':
      return [
        'rotate',
        String(input.degrees),
        ...optionalNumber(input.origin?.x),
        ...optionalNumber(input.origin?.y),
        ...optionalNumber(input.velocity),
      ];
    case 'transform':
      return [
        'transform',
        String(input.origin?.x),
        String(input.origin?.y),
        String(input.delta?.x),
        String(input.delta?.y),
        String(input.scale),
        String(input.degrees),
        ...optionalNumber(input.durationMs),
      ];
    default:
      throw new AppError(
        'INVALID_ARGS',
        'gesture requires pan, fling, pinch, rotate, or transform',
      );
  }
}

function panPositionals(input: SemanticRequestInput): string[] {
  return [
    'pan',
    String(input.x),
    String(input.y),
    String(input.dx),
    String(input.dy),
    ...optionalNumber(input.durationMs),
  ];
}

function flingPositionals(input: FlingOptions): string[] {
  const distance = input.durationMs !== undefined ? (input.distance ?? 180) : input.distance;
  return [
    'fling',
    input.direction,
    String(input.x),
    String(input.y),
    ...optionalNumber(distance),
    ...optionalNumber(input.durationMs),
  ];
}

function pinchPositionals(input: SemanticRequestInput): string[] {
  return ['pinch', String(input.scale), ...optionalNumber(input.x), ...optionalNumber(input.y)];
}

function rotateGesturePositionals(input: SemanticRequestInput): string[] {
  assertCompleteCenter(input as RotateGestureOptions);
  const center =
    input.x === undefined || input.y === undefined ? [] : [String(input.x), String(input.y)];
  return ['rotate', String(input.degrees), ...center, ...optionalNumber(input.velocity)];
}

function transformPositionals(input: SemanticRequestInput): string[] {
  return [
    'transform',
    String(input.x),
    String(input.y),
    String(input.dx),
    String(input.dy),
    String(input.scale),
    String(input.degrees),
    ...optionalNumber(input.durationMs),
  ];
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

function isPositionals(input: IsOptions): string[] {
  return [input.predicate, input.selector, ...(input.predicate === 'text' ? [input.value] : [])];
}

function findPositionals(input: FindOptions): string[] {
  const args =
    input.locator && input.locator !== 'any' ? [input.locator, input.query] : [input.query];
  switch (input.action) {
    case undefined:
    case 'click':
    case 'focus':
    case 'exists':
      return input.action ? [...args, input.action] : args;
    case 'getText':
      return [...args, 'get', 'text'];
    case 'getAttrs':
      return [...args, 'get', 'attrs'];
    case 'wait':
      return [...args, 'wait', ...optionalNumber(input.timeoutMs)];
    case 'fill':
    case 'type':
      return [...args, input.action, input.value];
  }
}

function settingsPositionals(input: SettingsUpdateOptions): string[] {
  if (input.setting === 'location' && input.state === 'set') {
    return [input.setting, input.state, String(input.latitude), String(input.longitude)];
  }
  if (input.setting === 'permission') {
    return [input.setting, input.state, input.permission, ...optionalString(input.mode)];
  }
  return [input.setting, input.state];
}

function assertCompleteCenter(input: RotateGestureOptions): void {
  if (
    (input.x === undefined && input.y !== undefined) ||
    (input.x !== undefined && input.y === undefined)
  ) {
    throw new AppError('INVALID_ARGS', 'gesture rotate center requires both x and y');
  }
}

function optionalString(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

function optionalNumber(value: number | undefined): string[] {
  return value === undefined ? [] : [String(value)];
}

function required(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('INVALID_ARGS', message);
  }
  return value;
}

const REPLAY_SHELL_ENV_PREFIX = 'AD_VAR_';

function collectReplayClientShellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && key.startsWith(REPLAY_SHELL_ENV_PREFIX)) {
      result[key] = value;
    }
  }
  return result;
}
