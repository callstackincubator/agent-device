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
import { parseDeviceRotation } from '../core/device-rotation.ts';
import { parseTimeout } from '../daemon/handlers/parse-utils.ts';
import { splitSelectorFromArgs, tryParseSelectorChain } from '../daemon/selectors.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { AppError } from '../utils/errors.ts';
import { parseGitHubActionsArtifactInstallSourceSpec } from '../utils/install-source-config.ts';
import { readLocationCoordinate } from '../utils/location-coordinates.ts';
import { assertResolvedAppsFilter } from './app-inventory-contract.ts';
import {
  screenshotFlagsFromOptions,
  screenshotOptionsFromFlags,
} from './capture-screenshot-options.ts';
import { compactRecord } from './semantic-common.ts';

export type SemanticDaemonRequest = {
  command: string;
  positionals: string[];
  options: InternalRequestOptions;
};

export type SemanticRequestInput = InternalRequestOptions & Record<string, any>;

export type SelectionOptions = {
  platform?: CliFlags['platform'];
  target?: CliFlags['target'];
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
};

export type DecodedFillTarget =
  | { kind: 'ref'; target: { ref: string; label?: string }; text: string }
  | { kind: 'selector'; target: { selector: string }; text: string }
  | { kind: 'point'; target: { x: number; y: number }; text: string };

export type WaitParsed =
  | { kind: 'sleep'; durationMs: number }
  | { kind: 'ref'; rawRef: string; timeoutMs: number | null }
  | { kind: 'selector'; selectorExpression: string; timeoutMs: number | null }
  | { kind: 'text'; text: string; timeoutMs: number | null };

type CliReader = (positionals: string[], flags: CliFlags) => Record<string, unknown>;
type DaemonWriter = (input: SemanticRequestInput) => SemanticDaemonRequest;

const cliReaders = {
  devices: (_positionals, flags) => commonInputFromFlags(flags),
  apps: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    appsFilter: assertResolvedAppsFilter(flags.appsFilter),
  }),
  session: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: positionals[0] ?? 'list',
  }),
  boot: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    headless: flags.headless,
  }),
  open: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    app: positionals[0],
    url: positionals[1],
    surface: flags.surface,
    activity: flags.activity,
    launchConsole: flags.launchConsole,
    relaunch: flags.relaunch,
    saveScript: flags.saveScript,
    noRecord: flags.noRecord,
  }),
  close: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    app: positionals[0],
    shutdown: flags.shutdown,
    saveScript: flags.saveScript,
  }),
  install: installInputFromCli,
  reinstall: installInputFromCli,
  'install-from-source': (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    source: resolveInstallSource(positionals, flags),
    retainPaths: flags.retainPaths,
    retentionMs: flags.retentionMs,
  }),
  snapshot: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    interactiveOnly: flags.snapshotInteractiveOnly,
    compact: flags.snapshotCompact,
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
    forceFull: flags.snapshotForceFull,
  }),
  screenshot: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    path: positionals[0] ?? flags.out,
    ...screenshotOptionsFromFlags(flags),
  }),
  diff: (positionals, flags) => {
    if (positionals[0] !== 'snapshot') {
      throw new AppError('INVALID_ARGS', 'Only diff snapshot is semantically migrated.');
    }
    return {
      ...commonInputFromFlags(flags),
      kind: 'snapshot',
      out: flags.out,
      interactiveOnly: flags.snapshotInteractiveOnly,
      compact: flags.snapshotCompact,
      depth: flags.snapshotDepth,
      scope: flags.snapshotScope,
      raw: flags.snapshotRaw,
    };
  },
  metro: metroInputFromCli,
  click: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...selectorSnapshotInputFromFlags(flags),
    ...repeatedInputFromFlags(flags),
    target: semanticTargetFromClientTarget(readInteractionTargetFromPositionals(positionals)),
    button: flags.clickButton,
  }),
  push: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    app: requiredString(positionals[0], 'push requires bundleOrPackage'),
    payload: requiredString(positionals[1], 'push requires payloadOrJson'),
  }),
  perf: (_positionals, flags) => commonInputFromFlags(flags),
  get: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...selectorSnapshotInputFromFlags(flags),
    format: readGetFormat(positionals[0]),
    target: semanticTargetFromClientTarget(readElementTargetFromPositionals(positionals.slice(1))),
  }),
  replay: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    path: requiredString(positionals[0], 'replay requires path'),
    update: flags.replayUpdate,
    backend: flags.replayMaestro ? 'maestro' : undefined,
    env: flags.replayEnv,
  }),
  test: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    paths: positionals,
    update: flags.replayUpdate,
    env: flags.replayEnv,
    failFast: flags.failFast,
    timeoutMs: flags.timeoutMs,
    retries: flags.retries,
    artifactsDir: flags.artifactsDir,
    reportJunit: flags.reportJunit,
  }),
  press: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...selectorSnapshotInputFromFlags(flags),
    ...repeatedInputFromFlags(flags),
    target: semanticTargetFromClientTarget(readInteractionTargetFromPositionals(positionals)),
  }),
  longpress: (positionals, flags) => {
    const decoded = readLongPressTargetFromPositionals(positionals);
    return {
      ...commonInputFromFlags(flags),
      ...selectorSnapshotInputFromFlags(flags),
      target: semanticTargetFromClientTarget(decoded),
      durationMs: decoded.durationMs,
    };
  },
  swipe: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    from: { x: Number(positionals[0]), y: Number(positionals[1]) },
    to: { x: Number(positionals[2]), y: Number(positionals[3]) },
    durationMs: optionalCliNumber(positionals[4]),
    count: flags.count,
    pauseMs: flags.pauseMs,
    pattern: flags.pattern,
  }),
  fill: (positionals, flags) => {
    const decoded = readFillTargetFromPositionals(positionals);
    return {
      ...commonInputFromFlags(flags),
      ...selectorSnapshotInputFromFlags(flags),
      target: semanticTargetFromClientTarget(decoded.target),
      text: decoded.text,
      delayMs: flags.delayMs,
    };
  },
  batch: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    steps: readSemanticBatchStepsFromCli(flags.batchSteps ?? []),
    onError: flags.batchOnError,
    maxSteps: flags.batchMaxSteps,
    out: flags.out,
  }),
  gesture: gestureInputFromCli,
  focus: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    x: Number(positionals[0]),
    y: Number(positionals[1]),
  }),
  type: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    text: positionals.join(' '),
    delayMs: flags.delayMs,
  }),
  scroll: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    direction: readScrollDirection(positionals[0]),
    amount: optionalCliNumber(positionals[1]),
    pixels: flags.pixels,
  }),
  'trigger-app-event': (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    event: requiredString(positionals[0], 'trigger-app-event requires event'),
    payload: positionals[1]
      ? readJsonObject(positionals[1], 'trigger-app-event payload')
      : undefined,
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
  'react-native': (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readReactNativeAction(positionals[0]),
  }),
  find: (positionals, flags) => readFindOptionsFromPositionals(positionals, flags),
  is: (positionals, flags) => readIsOptionsFromPositionals(positionals, flags),
  settings: (positionals, flags) => readSettingsOptionsFromPositionals(positionals, flags),
  wait: (positionals, flags) => readWaitOptionsFromPositionals(positionals, flags),
  alert: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readAlertInput(positionals),
  }),
  appstate: (_positionals, flags) => commonInputFromFlags(flags),
  home: (_positionals, flags) => commonInputFromFlags(flags),
  'app-switcher': (_positionals, flags) => commonInputFromFlags(flags),
  back: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    mode: flags.backMode,
  }),
  rotate: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    orientation: parseDeviceRotation(positionals[0]),
  }),
  keyboard: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readKeyboardInput(positionals),
  }),
  clipboard: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readClipboardInput(positionals),
  }),
} satisfies Record<string, CliReader>;

const daemonWriters = {
  devices: direct(PUBLIC_COMMANDS.devices),
  boot: direct(PUBLIC_COMMANDS.boot),
  apps: direct(PUBLIC_COMMANDS.apps),
  open: direct(PUBLIC_COMMANDS.open, openPositionals),
  close: direct(PUBLIC_COMMANDS.close, (input) => optionalString(input.app)),
  install: direct(PUBLIC_COMMANDS.install, (input) => requiredPair(input.app, input.appPath)),
  reinstall: direct(PUBLIC_COMMANDS.reinstall, (input) => requiredPair(input.app, input.appPath)),
  'install-from-source': (input) =>
    request(INTERNAL_COMMANDS.installSource, [], {
      ...input,
      installSource: input.source,
      retainMaterializedPaths: input.retainPaths,
      materializedPathRetentionMs: input.retentionMs,
    }),
  push: direct(PUBLIC_COMMANDS.push, (input) => pushPositionals(input as AppPushOptions)),
  'trigger-app-event': direct(PUBLIC_COMMANDS.triggerAppEvent, (input) =>
    triggerEventPositionals(input as AppTriggerEventOptions),
  ),
  snapshot: direct(PUBLIC_COMMANDS.snapshot),
  screenshot: (input) =>
    request(PUBLIC_COMMANDS.screenshot, optionalString(input.path), {
      ...input,
      ...screenshotFlagsFromOptions(input as CaptureScreenshotOptions),
    }),
  diff: direct(PUBLIC_COMMANDS.diff, (input) => [
    requiredDaemonString(input.kind, 'diff requires kind'),
  ]),
  wait: direct(PUBLIC_COMMANDS.wait, (input) => waitPositionals(input as WaitCommandOptions)),
  alert: direct(PUBLIC_COMMANDS.alert, (input) => alertPositionals(input as AlertCommandOptions)),
  appstate: direct(PUBLIC_COMMANDS.appState),
  back: (input) => request(PUBLIC_COMMANDS.back, [], { ...input, backMode: input.mode }),
  home: direct(PUBLIC_COMMANDS.home),
  rotate: direct(PUBLIC_COMMANDS.rotate, (input) => [
    requiredDaemonString(input.orientation, 'rotate requires orientation'),
  ]),
  'app-switcher': direct(PUBLIC_COMMANDS.appSwitcher),
  keyboard: direct(PUBLIC_COMMANDS.keyboard, (input) => optionalString(input.action)),
  clipboard: direct(PUBLIC_COMMANDS.clipboard, (input) =>
    clipboardPositionals(input as ClipboardCommandOptions),
  ),
  'react-native': direct(PUBLIC_COMMANDS.reactNative, (input) => [
    requiredDaemonString(input.action, 'react-native requires action'),
  ]),
  click: (input) =>
    request(PUBLIC_COMMANDS.click, interactionTargetPositionals(input as InteractionTarget), {
      ...input,
      clickButton: input.button,
    }),
  press: direct(PUBLIC_COMMANDS.press, (input) =>
    interactionTargetPositionals(input as InteractionTarget),
  ),
  longpress: direct(PUBLIC_COMMANDS.longPress, (input) =>
    longPressPositionals(input as LongPressOptions),
  ),
  swipe: direct(PUBLIC_COMMANDS.swipe, swipePositionals),
  gesture: direct(PUBLIC_COMMANDS.gesture, semanticGesturePositionals),
  'gesture-pan': direct(PUBLIC_COMMANDS.gesture, panPositionals),
  'gesture-fling': direct(PUBLIC_COMMANDS.gesture, (input) =>
    flingPositionals(input as FlingOptions),
  ),
  'gesture-pinch': direct(PUBLIC_COMMANDS.gesture, pinchPositionals),
  'gesture-rotate': direct(PUBLIC_COMMANDS.gesture, (input) =>
    rotateGesturePositionals(input as RotateGestureOptions),
  ),
  'gesture-transform': direct(PUBLIC_COMMANDS.gesture, transformPositionals),
  focus: direct(PUBLIC_COMMANDS.focus, (input) => [String(input.x), String(input.y)]),
  type: direct(PUBLIC_COMMANDS.type, (input) => typePositionals(input as TypeTextOptions)),
  fill: direct(PUBLIC_COMMANDS.fill, (input) => fillPositionals(input as FillOptions)),
  scroll: direct(PUBLIC_COMMANDS.scroll, (input) => [
    requiredDaemonString(input.direction, 'scroll requires direction'),
    ...optionalNumber(input.amount),
  ]),
  get: direct(PUBLIC_COMMANDS.get, (input) => [
    requiredDaemonString(input.format, 'get requires format'),
    ...elementTargetPositionals(input as ElementTarget),
  ]),
  is: direct(PUBLIC_COMMANDS.is, (input) => isPositionals(input as IsOptions)),
  find: (input) =>
    request(PUBLIC_COMMANDS.find, findPositionals(input as FindOptions), {
      ...input,
      findFirst: input.first,
      findLast: input.last,
    }),
  replay: (input) =>
    request(PUBLIC_COMMANDS.replay, [requiredDaemonString(input.path, 'replay requires path')], {
      ...input,
      replayUpdate: input.update,
      replayBackend:
        input.backend ?? ((input as ReplayRunOptions).maestro === true ? 'maestro' : undefined),
      replayEnv: input.env,
      replayShellEnv: collectReplayClientShellEnv(process.env),
    }),
  test: (input) =>
    request(PUBLIC_COMMANDS.test, input.paths ?? [], {
      ...input,
      replayUpdate: input.update,
      replayEnv: input.env,
      replayShellEnv: collectReplayClientShellEnv(process.env),
    }),
  batch: (input) =>
    request(PUBLIC_COMMANDS.batch, [], {
      ...input,
      batchSteps: input.steps,
      batchOnError: input.onError,
      batchMaxSteps: input.maxSteps,
    }),
  perf: direct(PUBLIC_COMMANDS.perf),
  logs: direct(PUBLIC_COMMANDS.logs, (input) => logsPositionals(input as LogsOptions)),
  network: (input) =>
    request(PUBLIC_COMMANDS.network, networkPositionals(input as NetworkOptions), {
      ...input,
      networkInclude: input.include,
    }),
  record: direct(PUBLIC_COMMANDS.record, (input) => recordingPositionals(input as RecordOptions)),
  trace: direct(PUBLIC_COMMANDS.trace, (input) => recordingPositionals(input as RecordOptions)),
  settings: direct(PUBLIC_COMMANDS.settings, (input) =>
    settingsPositionals(input as SettingsUpdateOptions),
  ),
} satisfies Record<string, DaemonWriter>;

export type SemanticDaemonCommand = keyof typeof daemonWriters;
type NonBatchSemanticCommand =
  | 'replay'
  | 'batch'
  | 'gesture-pan'
  | 'gesture-fling'
  | 'gesture-pinch'
  | 'gesture-rotate'
  | 'gesture-transform';
export type SemanticBatchCommand = Exclude<SemanticDaemonCommand, NonBatchSemanticCommand>;

const semanticNonBatchCommandNames = commandNameSet([
  'replay',
  'batch',
  'gesture-pan',
  'gesture-fling',
  'gesture-pinch',
  'gesture-rotate',
  'gesture-transform',
] as const satisfies readonly NonBatchSemanticCommand[]);

export const semanticBatchCommandNames = (
  Object.keys(daemonWriters) as SemanticDaemonCommand[]
).filter((name): name is SemanticBatchCommand => !semanticNonBatchCommandNames.has(name));

const semanticBatchNames = commandNameSet(semanticBatchCommandNames);

export function readSemanticInputFromCli(
  command: string,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  const reader = (cliReaders as Record<string, CliReader>)[command];
  if (!reader) throw new AppError('INVALID_ARGS', `Unknown semantic CLI command: ${command}`);
  return reader(positionals, flags);
}

function readSemanticBatchStepsFromCli(
  steps: BatchStep[],
): Array<{ command: string; input: Record<string, unknown> }> {
  return steps.map((step, index) => {
    const command = readBatchCliCommand(step.command, index + 1);
    const input = readSemanticInputFromCli(
      command,
      step.positionals ?? [],
      cliFlagsFromBatchStep(step.flags),
    );
    if (step.runtime !== undefined) input.runtime = step.runtime;
    return { command, input };
  });
}

export function prepareSemanticBatchStep(
  command: SemanticDaemonCommand,
  input: SemanticRequestInput,
): BatchStep {
  const prepared = prepareSemanticDaemonRequest(command, input);
  return {
    command: prepared.command,
    positionals: prepared.positionals,
    flags: buildFlags(prepared.options),
    runtime: prepared.options.runtime,
  };
}

export function prepareSemanticDaemonRequest(
  command: SemanticDaemonCommand,
  input: SemanticRequestInput,
): SemanticDaemonRequest {
  return daemonWriters[command](input);
}

function selectionOptionsFromFlags(flags: CliFlags): SelectionOptions {
  return {
    platform: flags.platform,
    target: flags.target,
    device: flags.device,
    udid: flags.udid,
    serial: flags.serial,
    iosSimulatorDeviceSet: flags.iosSimulatorDeviceSet,
    androidDeviceAllowlist: flags.androidDeviceAllowlist,
  };
}

function selectorSnapshotOptionsFromFlags(flags: CliFlags): {
  depth?: number;
  scope?: string;
  raw?: boolean;
} {
  return {
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  };
}

export function readInteractionTargetFromPositionals(positionals: string[]): InteractionTarget {
  if (positionals[0]?.startsWith('@')) {
    const label = optionalTrimmedText(positionals.slice(1));
    return { ref: positionals[0], ...(label === undefined ? {} : { label }) };
  }
  const selectorArgs = splitSelectorFromArgs(positionals);
  if (selectorArgs) return { selector: selectorArgs.selectorExpression };
  return { x: Number(positionals[0]), y: Number(positionals[1]) };
}

export function readLongPressTargetFromPositionals(positionals: string[]): LongPressOptions {
  const targetPositionals = readLongPressTargetPositionals(positionals);
  return {
    ...readInteractionTargetFromPositionals(targetPositionals.target),
    ...(targetPositionals.durationMs !== undefined
      ? { durationMs: targetPositionals.durationMs }
      : {}),
  };
}

function readElementTargetFromPositionals(positionals: string[]): ElementTarget {
  if (positionals[0]?.startsWith('@')) {
    return { ref: positionals[0], label: optionalTrimmedText(positionals.slice(1)) };
  }
  const selector = positionals.join(' ').trim();
  if (!selector) throw new AppError('INVALID_ARGS', 'get requires @ref or selector expression');
  return { selector };
}

export function readFillTargetFromPositionals(positionals: string[]): DecodedFillTarget {
  if (positionals[0]?.startsWith('@')) {
    const text =
      positionals.length >= 3 ? positionals.slice(2).join(' ') : positionals.slice(1).join(' ');
    return {
      kind: 'ref',
      target: {
        ref: positionals[0],
        label: positionals.length >= 3 ? optionalTrimmedText([positionals[1]]) : undefined,
      },
      text,
    };
  }
  const selectorArgs = splitSelectorFromArgs(positionals, { preferTrailingValue: true });
  if (selectorArgs) {
    return {
      kind: 'selector',
      target: { selector: selectorArgs.selectorExpression },
      text: selectorArgs.rest.join(' '),
    };
  }
  return {
    kind: 'point',
    target: { x: Number(positionals[0]), y: Number(positionals[1]) },
    text: positionals.slice(2).join(' '),
  };
}

export function readWaitOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): WaitCommandOptions {
  const parsed = parseWaitPositionals(positionals);
  if (!parsed) {
    throw new AppError(
      'INVALID_ARGS',
      'wait requires <ms>, text <text>, @ref, or <selector> [timeoutMs].',
    );
  }
  const base = {
    ...selectionOptionsFromFlags(flags),
    ...selectorSnapshotOptionsFromFlags(flags),
  };
  if (parsed.kind === 'sleep') return { ...base, durationMs: parsed.durationMs };
  if (parsed.kind === 'text') {
    if (!parsed.text) throw new AppError('INVALID_ARGS', 'wait requires text.');
    return { ...base, text: parsed.text, ...readTimeoutOption(parsed.timeoutMs) };
  }
  if (parsed.kind === 'ref') {
    return { ...base, ref: parsed.rawRef, ...readTimeoutOption(parsed.timeoutMs) };
  }
  return {
    ...base,
    selector: parsed.selectorExpression,
    ...readTimeoutOption(parsed.timeoutMs),
  };
}

export function parseWaitPositionals(args: string[]): WaitParsed | null {
  if (args.length === 0) return null;
  const sleepMs = parseTimeout(args[0]);
  if (sleepMs !== null) return { kind: 'sleep', durationMs: sleepMs };
  const timeoutMs = parseTimeout(args[args.length - 1]);
  if (args[0] === 'text') {
    const text = timeoutMs !== null ? args.slice(1, -1).join(' ') : args.slice(1).join(' ');
    return { kind: 'text', text: text.trim(), timeoutMs };
  }
  if (args[0].startsWith('@')) return { kind: 'ref', rawRef: args[0], timeoutMs };
  const argsWithoutTimeout = timeoutMs !== null ? args.slice(0, -1) : args.slice();
  const split = splitSelectorFromArgs(argsWithoutTimeout);
  if (split && split.rest.length === 0 && tryParseSelectorChain(split.selectorExpression)) {
    return { kind: 'selector', selectorExpression: split.selectorExpression, timeoutMs };
  }
  const text = timeoutMs !== null ? args.slice(0, -1).join(' ') : args.join(' ');
  return { kind: 'text', text: text.trim(), timeoutMs };
}

// fallow-ignore-next-line complexity
function readFindOptionsFromPositionals(positionals: string[], flags: CliFlags): FindOptions {
  const base = {
    ...findSnapshotOptionsFromFlags(flags),
    ...selectionOptionsFromFlags(flags),
    first: flags.findFirst,
    last: flags.findLast,
  };
  const locator = readFindLocator(positionals[0]);
  const hasExplicitLocator = locator !== undefined;
  const query = hasExplicitLocator ? positionals[1] : positionals[0];
  const actionOffset = hasExplicitLocator ? 2 : 1;
  const action = positionals[actionOffset];
  if (action === undefined) return { ...base, locator, query: readRequiredQuery(query) };
  if (action === 'get') {
    const subcommand = positionals[actionOffset + 1];
    if (subcommand === 'text') {
      return { ...base, locator, query: readRequiredQuery(query), action: 'getText' };
    }
    if (subcommand === 'attrs') {
      return { ...base, locator, query: readRequiredQuery(query), action: 'getAttrs' };
    }
    throw new AppError('INVALID_ARGS', 'find get only supports text or attrs');
  }
  if (action === 'wait') {
    return {
      ...base,
      locator,
      query: readRequiredQuery(query),
      action: 'wait',
      timeoutMs: optionalCliNumber(positionals[actionOffset + 1]),
    };
  }
  if (action === 'fill' || action === 'type') {
    return {
      ...base,
      locator,
      query: readRequiredQuery(query),
      action,
      value: positionals.slice(actionOffset + 1).join(' '),
    };
  }
  if (action === 'click' || action === 'focus' || action === 'exists') {
    return { ...base, locator, query: readRequiredQuery(query), action };
  }
  throw new AppError('INVALID_ARGS', `Unsupported find action: ${action}`);
}

function readIsOptionsFromPositionals(positionals: string[], flags: CliFlags): IsOptions {
  const base = {
    ...selectorSnapshotOptionsFromFlags(flags),
    ...selectionOptionsFromFlags(flags),
  };
  const predicate = positionals[0];
  const split = splitSelectorFromArgs(positionals.slice(1), {
    preferTrailingValue: predicate === 'text',
  });
  if (!split) throw new AppError('INVALID_ARGS', 'is requires a selector expression');
  if (predicate === 'text') {
    return { ...base, predicate, selector: split.selectorExpression, value: split.rest.join(' ') };
  }
  if (
    predicate === 'visible' ||
    predicate === 'hidden' ||
    predicate === 'exists' ||
    predicate === 'editable' ||
    predicate === 'selected'
  ) {
    return { ...base, predicate, selector: split.selectorExpression };
  }
  throw new AppError(
    'INVALID_ARGS',
    'is requires predicate: visible|hidden|exists|editable|selected|text',
  );
}

// fallow-ignore-next-line complexity
function readSettingsOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): SettingsUpdateOptions {
  const base = selectionOptionsFromFlags(flags);
  const setting = positionals[0];
  const state = positionals[1];
  if (isOneOf(setting, ON_OFF_SETTINGS) && isOneOf(state, ON_OFF_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'location' && state === 'set') {
    return {
      ...base,
      setting,
      state,
      latitude: readLocationCoordinate(positionals[2], 'latitude'),
      longitude: readLocationCoordinate(positionals[3], 'longitude'),
    };
  }
  if (setting === 'appearance' && isOneOf(state, APPEARANCE_STATES)) {
    return { ...base, setting, state };
  }
  if (isOneOf(setting, BIOMETRIC_SETTINGS) && isOneOf(state, BIOMETRIC_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'fingerprint' && isOneOf(state, FINGERPRINT_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'permission' && isOneOf(state, PERMISSION_STATES)) {
    return {
      ...base,
      setting,
      state,
      permission: readPermission(positionals[2]),
      mode: readPermissionMode(positionals[3]),
    };
  }
  throw new AppError('INVALID_ARGS', 'Invalid settings arguments.');
}

function direct(
  command: string,
  positionals?: (input: SemanticRequestInput) => string[],
): DaemonWriter {
  return (input) => request(command, positionals ? positionals(input) : [], input);
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

function installInputFromCli(
  positionals: string[],
  flags: CliFlags,
  command = 'install',
): Record<string, unknown> {
  return {
    ...commonInputFromFlags(flags),
    app: requiredString(positionals[0], `${command} requires app`),
    appPath: requiredString(positionals[1], `${command} requires path`),
  };
}

function commonInputFromFlags(flags: CliFlags): Record<string, unknown> {
  return compactRecord({
    session: flags.session,
    platform: flags.platform,
    deviceTarget: flags.target,
    device: flags.device,
    udid: flags.udid,
    serial: flags.serial,
    iosSimulatorDeviceSet: flags.iosSimulatorDeviceSet,
    androidDeviceAllowlist: flags.androidDeviceAllowlist,
  });
}

function selectorSnapshotInputFromFlags(flags: CliFlags): Record<string, unknown> {
  return compactRecord({
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  });
}

function repeatedInputFromFlags(flags: CliFlags): Record<string, unknown> {
  return compactRecord({
    count: flags.count,
    intervalMs: flags.intervalMs,
    holdMs: flags.holdMs,
    jitterPx: flags.jitterPx,
    doubleTap: flags.doubleTap,
  });
}

function semanticTargetFromClientTarget(
  target: InteractionTarget | ElementTarget,
): Record<string, unknown> {
  if ('ref' in target && target.ref !== undefined) {
    return compactRecord({ kind: 'ref', ref: target.ref, label: target.label });
  }
  if ('selector' in target && target.selector !== undefined) {
    return { kind: 'selector', selector: target.selector };
  }
  const point = target as { x: number; y: number };
  return { kind: 'point', x: point.x, y: point.y };
}

function readBatchCliCommand(command: string, stepNumber: number): SemanticBatchCommand {
  const normalized = command.trim().toLowerCase();
  if (isSemanticBatchCommand(normalized)) return normalized;
  throw new AppError(
    'INVALID_ARGS',
    `Batch step ${stepNumber} command is not available through semantic batch: ${command}`,
  );
}

function isSemanticBatchCommand(name: string): name is SemanticBatchCommand {
  return semanticBatchNames.has(name);
}

function cliFlagsFromBatchStep(flags: BatchStep['flags']): CliFlags {
  return {
    json: false,
    help: false,
    version: false,
    ...(flags as Partial<CliFlags> | undefined),
  };
}

// fallow-ignore-next-line complexity
function resolveInstallSource(positionals: string[], flags: CliFlags) {
  const url = positionals[0]?.trim();
  if (positionals.length > 1) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source accepts either one <url> positional or --github-actions-artifact',
    );
  }
  const githubArtifactSource = flags.githubActionsArtifact
    ? parseGitHubActionsArtifactInstallSourceSpec(flags.githubActionsArtifact)
    : undefined;
  const configuredSource = flags.installSource;
  const sourceCount = (url ? 1 : 0) + (githubArtifactSource ? 1 : 0) + (configuredSource ? 1 : 0);
  if (sourceCount !== 1) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source requires exactly one source: <url>, --github-actions-artifact, or config installSource',
    );
  }
  if (!url && flags.header && flags.header.length > 0) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source --header is only supported for URL sources',
    );
  }
  if (githubArtifactSource) return githubArtifactSource;
  if (configuredSource) return configuredSource;
  return {
    kind: 'url' as const,
    url: url!,
    headers: parseInstallSourceHeaders(flags.header),
  };
}

function parseInstallSourceHeaders(
  headerFlags: CliFlags['header'],
): Record<string, string> | undefined {
  if (!headerFlags || headerFlags.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const rawHeader of headerFlags) {
    const separator = rawHeader.indexOf(':');
    if (separator <= 0) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid --header value "${rawHeader}". Expected "name:value".`,
      );
    }
    const name = rawHeader.slice(0, separator).trim();
    const value = rawHeader.slice(separator + 1).trim();
    if (!name) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid --header value "${rawHeader}". Header name cannot be empty.`,
      );
    }
    headers[name] = value;
  }
  return headers;
}

// fallow-ignore-next-line complexity
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
    requiredDaemonString(first, 'missing first positional'),
    requiredDaemonString(second, 'missing second positional'),
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

// fallow-ignore-next-line complexity
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
        requiredDaemonString(input.direction, 'gesture fling requires direction'),
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

function rotateGesturePositionals(input: RotateGestureOptions): string[] {
  assertCompleteCenter(input);
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

// fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
function gestureInputFromCli(positionals: string[], flags: CliFlags): Record<string, unknown> {
  const subcommand = positionals[0];
  const args = positionals.slice(1);
  const common = commonInputFromFlags(flags);
  switch (subcommand) {
    case 'pan':
      return {
        ...common,
        kind: subcommand,
        origin: { x: Number(args[0]), y: Number(args[1]) },
        delta: { x: Number(args[2]), y: Number(args[3]) },
        durationMs: optionalCliNumber(args[4]),
      };
    case 'fling':
      return {
        ...common,
        kind: subcommand,
        direction: args[0],
        origin: { x: Number(args[1]), y: Number(args[2]) },
        distance: optionalCliNumber(args[3]),
        durationMs: optionalCliNumber(args[4]),
      };
    case 'pinch':
      return {
        ...common,
        kind: subcommand,
        scale: Number(args[0]),
        origin:
          args[1] === undefined || args[2] === undefined
            ? undefined
            : { x: Number(args[1]), y: Number(args[2]) },
      };
    case 'rotate':
      return {
        ...common,
        kind: subcommand,
        degrees: Number(args[0]),
        origin:
          args[1] === undefined || args[2] === undefined
            ? undefined
            : { x: Number(args[1]), y: Number(args[2]) },
        velocity: optionalCliNumber(args[3]),
      };
    case 'transform':
      return {
        ...common,
        kind: subcommand,
        origin: { x: Number(args[0]), y: Number(args[1]) },
        delta: { x: Number(args[2]), y: Number(args[3]) },
        scale: Number(args[4]),
        degrees: Number(args[5]),
        durationMs: optionalCliNumber(args[6]),
      };
    default:
      throw new AppError(
        'INVALID_ARGS',
        'gesture requires pan, fling, pinch, rotate, or transform',
      );
  }
}

// fallow-ignore-next-line complexity
function metroInputFromCli(positionals: string[], flags: CliFlags): Record<string, unknown> {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action !== 'prepare' && action !== 'reload') {
    throw new AppError('INVALID_ARGS', 'metro requires a subcommand: prepare or reload');
  }
  if (action === 'reload') {
    return {
      action,
      metroHost: flags.metroHost,
      metroPort: flags.metroPort,
      bundleUrl: flags.bundleUrl,
      timeoutMs: flags.metroProbeTimeoutMs,
    };
  }
  if (!flags.metroPublicBaseUrl && !flags.metroProxyBaseUrl) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare requires --public-base-url <url> or --proxy-base-url <url>.',
    );
  }
  return {
    action,
    projectRoot: flags.metroProjectRoot,
    kind: flags.metroKind,
    port: flags.metroPreparePort,
    listenHost: flags.metroListenHost,
    statusHost: flags.metroStatusHost,
    publicBaseUrl: flags.metroPublicBaseUrl,
    proxyBaseUrl: flags.metroProxyBaseUrl,
    bearerToken: flags.metroBearerToken,
    bridgeScope:
      flags.tenant && flags.runId && flags.leaseId
        ? {
            tenantId: flags.tenant,
            runId: flags.runId,
            leaseId: flags.leaseId,
          }
        : undefined,
    startupTimeoutMs: flags.metroStartupTimeoutMs,
    probeTimeoutMs: flags.metroProbeTimeoutMs,
    reuseExisting: flags.metroNoReuseExisting ? false : undefined,
    installDependenciesIfNeeded: flags.metroNoInstallDeps ? false : undefined,
    runtimeFilePath: flags.metroRuntimeFile,
  };
}

function readGetFormat(value: string | undefined): 'text' | 'attrs' {
  if (value === 'text' || value === 'attrs') return value;
  throw new AppError('INVALID_ARGS', 'get only supports text or attrs');
}

function readScrollDirection(
  value: string | undefined,
): 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom' {
  if (
    value === 'up' ||
    value === 'down' ||
    value === 'left' ||
    value === 'right' ||
    value === 'top' ||
    value === 'bottom'
  ) {
    return value;
  }
  throw new AppError('INVALID_ARGS', `Unknown direction: ${String(value)}`);
}

function readStartStop(value: string | undefined, command: string): 'start' | 'stop' {
  if (value === 'start' || value === 'stop') return value;
  throw new AppError('INVALID_ARGS', `${command} requires start|stop`);
}

function readLogsAction(
  value: string | undefined,
): 'path' | 'start' | 'stop' | 'doctor' | 'mark' | 'clear' | undefined {
  if (value === undefined) return undefined;
  if (
    value === 'path' ||
    value === 'start' ||
    value === 'stop' ||
    value === 'doctor' ||
    value === 'mark' ||
    value === 'clear'
  ) {
    return value;
  }
  throw new AppError('INVALID_ARGS', 'logs requires path, start, stop, doctor, mark, or clear');
}

function readNetworkAction(value: string | undefined): 'dump' | 'log' | undefined {
  if (value === undefined) return undefined;
  if (value === 'dump' || value === 'log') return value;
  throw new AppError('INVALID_ARGS', 'network requires dump or log');
}

function readNetworkInclude(
  value: string | undefined,
): 'summary' | 'headers' | 'body' | 'all' | undefined {
  if (value === undefined) return undefined;
  if (value === 'summary' || value === 'headers' || value === 'body' || value === 'all')
    return value;
  throw new AppError('INVALID_ARGS', 'network include mode must be summary, headers, body, or all');
}

function readJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new AppError('INVALID_ARGS', `${label} must be a JSON object`);
}

function readReactNativeAction(value: string | undefined): 'dismiss-overlay' {
  if (value === 'dismiss-overlay') return value;
  throw new AppError('INVALID_ARGS', 'react-native supports only: dismiss-overlay');
}

function readAlertInput(positionals: string[]): Record<string, unknown> {
  if (positionals.length > 2) {
    throw new AppError('INVALID_ARGS', 'alert accepts at most action and timeout arguments.');
  }
  const action = readAlertAction(positionals[0]);
  const timeoutMs = readFiniteNumber(positionals[1], 'alert timeout');
  return compactRecord({ action, timeoutMs });
}

function readKeyboardInput(positionals: string[]): Record<string, unknown> {
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'keyboard accepts at most one action argument.');
  }
  return compactRecord({ action: readKeyboardAction(positionals[0]) });
}

function readClipboardInput(positionals: string[]): Record<string, unknown> {
  const action = positionals[0]?.toLowerCase();
  if (action !== 'read' && action !== 'write') {
    throw new AppError('INVALID_ARGS', 'clipboard requires a subcommand: read or write.');
  }
  if (action === 'read') {
    if (positionals.length !== 1) {
      throw new AppError('INVALID_ARGS', 'clipboard read does not accept additional arguments.');
    }
    return { action };
  }
  if (positionals.length < 2) {
    throw new AppError('INVALID_ARGS', 'clipboard write requires text.');
  }
  return { action, text: positionals.slice(1).join(' ') };
}

function readAlertAction(
  value: string | undefined,
): 'get' | 'accept' | 'dismiss' | 'wait' | undefined {
  const action = value?.toLowerCase();
  if (
    action === undefined ||
    action === 'get' ||
    action === 'accept' ||
    action === 'dismiss' ||
    action === 'wait'
  ) {
    return action;
  }
  throw new AppError('INVALID_ARGS', 'alert action must be get, accept, dismiss, or wait.');
}

function readKeyboardAction(value: string | undefined): 'status' | 'dismiss' | undefined {
  const action = value?.toLowerCase();
  if (action === 'get') return 'status';
  if (action === undefined || action === 'status' || action === 'dismiss') return action;
  throw new AppError('INVALID_ARGS', 'keyboard action must be status, get, or dismiss.');
}

function readFindLocator(value: string | undefined): FindOptions['locator'] | undefined {
  if (
    value === 'text' ||
    value === 'label' ||
    value === 'value' ||
    value === 'role' ||
    value === 'id'
  ) {
    return value;
  }
  return undefined;
}

function findSnapshotOptionsFromFlags(flags: CliFlags): {
  depth?: number;
  raw?: boolean;
} {
  return {
    depth: flags.snapshotDepth,
    raw: flags.snapshotRaw,
  };
}

function readRequiredQuery(value: string | undefined): string {
  if (value === undefined || value === '')
    throw new AppError('INVALID_ARGS', 'find requires query');
  return value;
}

function readTimeoutOption(timeoutMs: number | null): { timeoutMs?: number } {
  return timeoutMs === null ? {} : { timeoutMs };
}

function readPermission(value: string | undefined): PermissionTarget {
  if (isOneOf(value, PERMISSION_TARGETS)) return value;
  throw new AppError('INVALID_ARGS', 'settings permission requires a permission target.');
}

function readPermissionMode(value: string | undefined): 'full' | 'limited' | undefined {
  if (value === undefined || value === 'full' || value === 'limited') return value;
  throw new AppError('INVALID_ARGS', 'settings permission mode must be full or limited.');
}

function optionalTrimmedText(values: string[]): string | undefined {
  const text = values.join(' ').trim();
  return text || undefined;
}

function readLongPressTargetPositionals(positionals: string[]): {
  target: string[];
  durationMs?: number;
} {
  if (isFiniteNumberString(positionals[0]) && isFiniteNumberString(positionals[1])) {
    return {
      target: positionals.slice(0, 2),
      ...(positionals[2] !== undefined ? { durationMs: Number(positionals[2]) } : {}),
    };
  }
  const last = positionals.at(-1);
  if (positionals.length > 1 && isFiniteNumberString(last)) {
    return { target: positionals.slice(0, -1), durationMs: Number(last) };
  }
  return { target: positionals };
}

function assertCompleteCenter(input: RotateGestureOptions): void {
  if (
    (input.x === undefined && input.y !== undefined) ||
    (input.x !== undefined && input.y === undefined)
  ) {
    throw new AppError('INVALID_ARGS', 'gesture rotate center requires both x and y');
  }
}

function setOf<T extends string>(...values: T[]): ReadonlySet<T> {
  return new Set(values);
}

function commandNameSet<const TName extends string>(names: readonly TName[]): ReadonlySet<string> {
  return new Set(names);
}

function isOneOf<T extends string>(value: string | undefined, values: ReadonlySet<T>): value is T {
  return value !== undefined && values.has(value as T);
}

function isFiniteNumberString(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

function readFiniteNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new AppError('INVALID_ARGS', `${label} must be a finite number.`);
}

function optionalCliNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function optionalString(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

function optionalNumber(value: number | undefined): string[] {
  return value === undefined ? [] : [String(value)];
}

function requiredString(value: string | undefined, message: string): string {
  if (value === undefined || value === '') throw new AppError('INVALID_ARGS', message);
  return value;
}

function requiredDaemonString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('INVALID_ARGS', message);
  }
  return value;
}

const REPLAY_SHELL_ENV_PREFIX = 'AD_VAR_';

function collectReplayClientShellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && key.startsWith(REPLAY_SHELL_ENV_PREFIX)) result[key] = value;
  }
  return result;
}

type PermissionTarget = Extract<SettingsUpdateOptions, { setting: 'permission' }>['permission'];
type OnOffSetting = Extract<SettingsUpdateOptions, { state: 'on' | 'off' }>['setting'];
type OnOffState = Extract<SettingsUpdateOptions, { state: 'on' | 'off' }>['state'];
type BiometricSetting = Extract<
  SettingsUpdateOptions,
  { setting: 'faceid' | 'touchid' }
>['setting'];
type BiometricState = Extract<SettingsUpdateOptions, { setting: 'faceid' | 'touchid' }>['state'];
type FingerprintState = Extract<SettingsUpdateOptions, { setting: 'fingerprint' }>['state'];
type AppearanceState = Extract<SettingsUpdateOptions, { setting: 'appearance' }>['state'];
type PermissionState = Extract<SettingsUpdateOptions, { setting: 'permission' }>['state'];

const ON_OFF_SETTINGS = setOf<OnOffSetting>('wifi', 'airplane', 'location', 'animations');
const ON_OFF_STATES = setOf<OnOffState>('on', 'off');
const APPEARANCE_STATES = setOf<AppearanceState>('light', 'dark', 'toggle');
const BIOMETRIC_SETTINGS = setOf<BiometricSetting>('faceid', 'touchid');
const BIOMETRIC_STATES = setOf<BiometricState>('match', 'nonmatch', 'enroll', 'unenroll');
const FINGERPRINT_STATES = setOf<FingerprintState>('match', 'nonmatch');
const PERMISSION_STATES = setOf<PermissionState>('grant', 'deny', 'reset');
const PERMISSION_TARGETS = setOf<PermissionTarget>(
  'camera',
  'microphone',
  'photos',
  'contacts',
  'contacts-limited',
  'notifications',
  'calendar',
  'location',
  'location-always',
  'media-library',
  'motion',
  'reminders',
  'siri',
  'accessibility',
  'screen-recording',
  'input-monitoring',
);
