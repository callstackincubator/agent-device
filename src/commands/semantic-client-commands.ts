import type {
  AgentDeviceClient,
  AlertCommandOptions,
  AppCloseOptions,
  AppDeployOptions,
  AppInstallFromSourceOptions,
  AppListOptions,
  AppOpenOptions,
  AppPushOptions,
  AppSwitcherCommandOptions,
  AppTriggerEventOptions,
  BackCommandOptions,
  CaptureDiffOptions,
  CaptureScreenshotOptions,
  CaptureSnapshotOptions,
  ClipboardCommandOptions,
  FindOptions,
  FocusOptions,
  GetOptions,
  HomeCommandOptions,
  IsOptions,
  KeyboardCommandOptions,
  LogsOptions,
  LongPressOptions,
  MetroPrepareOptions,
  MetroReloadOptions,
  NetworkOptions,
  PerfOptions,
  ReactNativeCommandOptions,
  RecordOptions,
  ReplayRunOptions,
  ReplayTestOptions,
  RotateCommandOptions,
  ScrollOptions,
  SettingsUpdateOptions,
  SwipeOptions,
  TraceOptions,
  TypeTextOptions,
  WaitCommandOptions,
} from '../client-types.ts';
import { defineSemanticCommand, type JsonSchema } from './semantic-contract.ts';
import {
  booleanSchema,
  commandInputSchema,
  commandResultSchema,
  enumSchema,
  integerSchema,
  looseObjectSchema,
  numberSchema,
  optionalEnum,
  readClientOptions,
  stringArraySchema,
  stringSchema,
} from './semantic-common.ts';

const SURFACE_VALUES = ['app', 'frontmost-app', 'desktop', 'menubar'] as const;
const WAIT_KIND_VALUES = ['duration', 'text', 'ref', 'selector'] as const;
const ALERT_ACTION_VALUES = ['get', 'accept', 'dismiss', 'wait'] as const;
const BACK_MODE_VALUES = ['in-app', 'system'] as const;
const ORIENTATION_VALUES = [
  'portrait',
  'portrait-upside-down',
  'landscape-left',
  'landscape-right',
] as const;
const CLIPBOARD_ACTION_VALUES = ['read', 'write'] as const;
const FIND_ACTION_VALUES = [
  'click',
  'focus',
  'exists',
  'getText',
  'getAttrs',
  'wait',
  'fill',
  'type',
] as const;
const FIND_LOCATOR_VALUES = ['any', 'text', 'label', 'value', 'role', 'id'] as const;
const LOG_ACTION_VALUES = ['path', 'start', 'stop', 'doctor', 'mark', 'clear'] as const;
const NETWORK_ACTION_VALUES = ['dump', 'log'] as const;
const NETWORK_INCLUDE_VALUES = ['summary', 'headers', 'body', 'all'] as const;
const START_STOP_VALUES = ['start', 'stop'] as const;
const SCROLL_DIRECTION_VALUES = ['up', 'down', 'left', 'right', 'top', 'bottom'] as const;
const SWIPE_PATTERN_VALUES = ['one-way', 'ping-pong'] as const;
const REACT_NATIVE_ACTION_VALUES = ['dismiss-overlay'] as const;
const METRO_ACTION_VALUES = ['prepare', 'reload'] as const;

type MetroInput = { action: 'prepare' | 'reload' } & MetroPrepareOptions & MetroReloadOptions;
type SessionInput = { action?: 'list' };

export const semanticClientCommands = [
  defineClientCommand('devices', 'List available devices.', {}, [], (client, input) =>
    client.devices.list(input),
  ),
  defineClientCommand<AppListOptions>(
    'apps',
    'List installed apps.',
    { appsFilter: enumSchema(['user', 'all']) },
    [],
    (client, input) => client.apps.list(input),
  ),
  defineClientCommand<SessionInput>(
    'session',
    'List active sessions.',
    { action: enumSchema(['list']) },
    [],
    async (client) => ({ sessions: await client.sessions.list() }),
  ),
  defineClientCommand<AppOpenOptions>(
    'open',
    'Open an app, deep link, URL, or platform surface.',
    {
      app: stringSchema('App name, bundle id, package, or URL.'),
      url: stringSchema('Optional URL passed with an app shell.'),
      surface: enumSchema(SURFACE_VALUES),
      activity: stringSchema('Android activity name.'),
      launchConsole: stringSchema('Launch console mode.'),
      relaunch: booleanSchema('Force relaunch.'),
      saveScript: { oneOf: [booleanSchema(), stringSchema()] },
      noRecord: booleanSchema('Do not record this action.'),
    },
    [],
    (client, input) => client.apps.open(input),
  ),
  defineClientCommand<AppCloseOptions & { shutdown?: boolean }>(
    'close',
    'Close an app or end the active session.',
    {
      app: stringSchema('Optional app to close.'),
      shutdown: booleanSchema('Shutdown the session/device where supported.'),
      saveScript: { oneOf: [booleanSchema(), stringSchema()] },
    },
    [],
    (client, input) =>
      input.app ? client.apps.close(input) : client.sessions.close(withoutApp(input)),
  ),
  defineClientCommand<AppDeployOptions>(
    'install',
    'Install an app binary.',
    { app: stringSchema(), appPath: stringSchema('Path to app binary.') },
    ['app', 'appPath'],
    (client, input) => client.apps.install(input),
  ),
  defineClientCommand<AppDeployOptions>(
    'reinstall',
    'Reinstall an app binary.',
    { app: stringSchema(), appPath: stringSchema('Path to app binary.') },
    ['app', 'appPath'],
    (client, input) => client.apps.reinstall(input),
  ),
  defineClientCommand<AppInstallFromSourceOptions>(
    'install-from-source',
    'Install an app from a structured source.',
    {
      source: looseObjectSchema('Install source object.'),
      retainPaths: booleanSchema(),
      retentionMs: integerSchema(),
    },
    ['source'],
    (client, input) => client.apps.installFromSource(input),
  ),
  defineClientCommand<AppPushOptions>(
    'push',
    'Deliver a push payload.',
    { app: stringSchema(), payload: { oneOf: [stringSchema(), looseObjectSchema()] } },
    ['app', 'payload'],
    (client, input) => client.apps.push(input),
  ),
  defineClientCommand<AppTriggerEventOptions>(
    'trigger-app-event',
    'Trigger an app-defined event.',
    { event: stringSchema(), payload: looseObjectSchema() },
    ['event'],
    (client, input) => client.apps.triggerEvent(input),
  ),
  defineClientCommand<CaptureSnapshotOptions>(
    'snapshot',
    'Capture an accessibility snapshot.',
    {
      interactiveOnly: booleanSchema(),
      compact: booleanSchema(),
      depth: integerSchema(),
      scope: stringSchema(),
      raw: booleanSchema(),
      forceFull: booleanSchema(),
    },
    [],
    (client, input) => client.capture.snapshot(input),
  ),
  defineClientCommand<CaptureScreenshotOptions>(
    'screenshot',
    'Capture a screenshot.',
    {
      path: stringSchema('Output path.'),
      overlayRefs: booleanSchema(),
      fullscreen: booleanSchema(),
      maxSize: integerSchema(),
      stabilize: booleanSchema(),
      surface: enumSchema(SURFACE_VALUES),
    },
    [],
    (client, input) => client.capture.screenshot(input),
  ),
  defineClientCommand<CaptureDiffOptions>(
    'diff',
    'Diff accessibility snapshots.',
    {
      kind: { type: 'string', const: 'snapshot' },
      out: stringSchema(),
      interactiveOnly: booleanSchema(),
      compact: booleanSchema(),
      depth: integerSchema(),
      scope: stringSchema(),
      raw: booleanSchema(),
    },
    ['kind'],
    (client, input) => client.capture.diff(input),
  ),
  defineClientCommand<WaitCommandOptions>(
    'wait',
    'Wait for duration, text, ref, or selector.',
    {
      kind: enumSchema(WAIT_KIND_VALUES),
      durationMs: integerSchema(),
      text: stringSchema(),
      ref: stringSchema(),
      selector: stringSchema(),
      timeoutMs: integerSchema(),
      depth: integerSchema(),
      scope: stringSchema(),
      raw: booleanSchema(),
    },
    ['kind'],
    (client, input) => client.command.wait(waitInputToOptions(input)),
  ),
  defineClientCommand<AlertCommandOptions>(
    'alert',
    'Inspect or handle platform alerts.',
    { action: enumSchema(ALERT_ACTION_VALUES), timeoutMs: integerSchema() },
    [],
    (client, input) => client.command.alert(input),
  ),
  defineClientCommand('appstate', 'Show foreground app or activity.', {}, [], (client, input) =>
    client.command.appState(input),
  ),
  defineClientCommand<BackCommandOptions>(
    'back',
    'Navigate back.',
    { mode: enumSchema(BACK_MODE_VALUES) },
    [],
    (client, input) => client.command.back(input),
  ),
  defineClientCommand<HomeCommandOptions>(
    'home',
    'Go to the home screen.',
    {},
    [],
    (client, input) => client.command.home(input),
  ),
  defineClientCommand<RotateCommandOptions>(
    'rotate',
    'Rotate device orientation.',
    { orientation: enumSchema(ORIENTATION_VALUES) },
    ['orientation'],
    (client, input) => client.command.rotate(input),
  ),
  defineClientCommand<AppSwitcherCommandOptions>(
    'app-switcher',
    'Open the app switcher.',
    {},
    [],
    (client, input) => client.command.appSwitcher(input),
  ),
  defineClientCommand<KeyboardCommandOptions>(
    'keyboard',
    'Inspect or dismiss the keyboard.',
    { action: enumSchema(['status', 'dismiss']) },
    [],
    (client, input) => client.command.keyboard(input),
  ),
  defineClientCommand<ClipboardCommandOptions>(
    'clipboard',
    'Read or write clipboard text.',
    { action: enumSchema(CLIPBOARD_ACTION_VALUES), text: stringSchema() },
    ['action'],
    (client, input) => client.command.clipboard(input),
  ),
  defineClientCommand<ReactNativeCommandOptions>(
    'react-native',
    'Run supported React Native app automation helpers.',
    { action: enumSchema(REACT_NATIVE_ACTION_VALUES) },
    ['action'],
    (client, input) => client.command.reactNative(input),
  ),
  defineClientCommand<LongPressOptions>(
    'longpress',
    'Long press by ref, selector, or point.',
    longPressProperties(),
    ['target'],
    (client, input) =>
      client.interactions.longPress(targetInputToOptions(input) as LongPressOptions),
  ),
  defineClientCommand<SwipeOptions>(
    'swipe',
    'Swipe between two points.',
    {
      from: pointSchema(),
      to: pointSchema(),
      durationMs: integerSchema(),
      count: integerSchema(),
      pauseMs: integerSchema(),
      pattern: enumSchema(SWIPE_PATTERN_VALUES),
    },
    ['from', 'to'],
    (client, input) => client.interactions.swipe(input),
  ),
  defineClientCommand<FocusOptions>(
    'focus',
    'Focus input at coordinates.',
    { x: numberSchema(), y: numberSchema() },
    ['x', 'y'],
    (client, input) => client.interactions.focus(input),
  ),
  defineClientCommand<TypeTextOptions>(
    'type',
    'Type text in the focused field.',
    { text: stringSchema(), delayMs: integerSchema() },
    ['text'],
    (client, input) => client.interactions.type(input),
  ),
  defineClientCommand<ScrollOptions>(
    'scroll',
    'Scroll in a direction or to an edge.',
    {
      direction: enumSchema(SCROLL_DIRECTION_VALUES),
      amount: numberSchema(),
      pixels: integerSchema(),
    },
    ['direction'],
    (client, input) => client.interactions.scroll(input),
  ),
  defineClientCommand<GetOptions>(
    'get',
    'Get element text or attributes.',
    {
      format: enumSchema(['text', 'attrs']),
      target: elementTargetSchema(),
      depth: integerSchema(),
      scope: stringSchema(),
      raw: booleanSchema(),
    },
    ['format', 'target'],
    (client, input) => client.interactions.get(elementTargetInputToOptions(input)),
  ),
  defineClientCommand<IsOptions>(
    'is',
    'Assert UI state.',
    {
      predicate: enumSchema(['visible', 'hidden', 'exists', 'editable', 'selected', 'text']),
      selector: stringSchema(),
      value: stringSchema(),
      depth: integerSchema(),
      scope: stringSchema(),
      raw: booleanSchema(),
    },
    ['predicate', 'selector'],
    (client, input) => client.interactions.is(input),
  ),
  defineClientCommand<FindOptions>(
    'find',
    'Find an element and optionally act on it.',
    {
      locator: enumSchema(FIND_LOCATOR_VALUES),
      query: stringSchema(),
      action: enumSchema(FIND_ACTION_VALUES),
      value: stringSchema(),
      timeoutMs: integerSchema(),
      first: booleanSchema(),
      last: booleanSchema(),
      depth: integerSchema(),
      raw: booleanSchema(),
    },
    ['query'],
    (client, input) => client.interactions.find(input),
  ),
  defineClientCommand<ReplayRunOptions>(
    'replay',
    'Replay a recorded session.',
    {
      path: stringSchema(),
      update: booleanSchema(),
      backend: stringSchema(),
      env: stringArraySchema(),
    },
    ['path'],
    (client, input) => client.replay.run(input),
  ),
  defineClientCommand<ReplayTestOptions>(
    'test',
    'Run one or more .ad scripts.',
    {
      paths: stringArraySchema(),
      update: booleanSchema(),
      env: stringArraySchema(),
      failFast: booleanSchema(),
      timeoutMs: integerSchema(),
      retries: integerSchema(),
      artifactsDir: stringSchema(),
      reportJunit: stringSchema(),
    },
    ['paths'],
    (client, input) => client.replay.test(input),
  ),
  defineClientCommand<PerfOptions>(
    'perf',
    'Show session performance metrics.',
    {},
    [],
    (client, input) => client.observability.perf(input),
  ),
  defineClientCommand<LogsOptions>(
    'logs',
    'Manage session app logs.',
    { action: enumSchema(LOG_ACTION_VALUES), message: stringSchema(), restart: booleanSchema() },
    [],
    (client, input) => client.observability.logs(input),
  ),
  defineClientCommand<NetworkOptions>(
    'network',
    'Show recent HTTP traffic.',
    {
      action: enumSchema(NETWORK_ACTION_VALUES),
      limit: integerSchema(),
      include: enumSchema(NETWORK_INCLUDE_VALUES),
    },
    [],
    (client, input) => client.observability.network(input),
  ),
  defineClientCommand<RecordOptions>(
    'record',
    'Start or stop screen recording.',
    {
      action: enumSchema(START_STOP_VALUES),
      path: stringSchema(),
      fps: integerSchema(),
      quality: integerSchema(),
      hideTouches: booleanSchema(),
    },
    ['action'],
    (client, input) => client.recording.record(input),
  ),
  defineClientCommand<TraceOptions>(
    'trace',
    'Start or stop trace capture.',
    { action: enumSchema(START_STOP_VALUES), path: stringSchema() },
    ['action'],
    (client, input) => client.recording.trace(input),
  ),
  defineClientCommand<SettingsUpdateOptions>(
    'settings',
    'Change OS settings and app permissions.',
    {
      setting: stringSchema(),
      state: stringSchema(),
      latitude: numberSchema(),
      longitude: numberSchema(),
      permission: stringSchema(),
      mode: enumSchema(['full', 'limited']),
    },
    ['setting', 'state'],
    (client, input) => client.settings.update(input),
  ),
  defineClientCommand<MetroInput>(
    'metro',
    'Prepare Metro runtime or reload React Native apps.',
    {
      action: enumSchema(METRO_ACTION_VALUES),
      projectRoot: stringSchema(),
      kind: stringSchema(),
      publicBaseUrl: stringSchema(),
      proxyBaseUrl: stringSchema(),
      bearerToken: stringSchema(),
      launchUrl: stringSchema(),
      port: integerSchema(),
      listenHost: stringSchema(),
      statusHost: stringSchema(),
      startupTimeoutMs: integerSchema(),
      probeTimeoutMs: integerSchema(),
      reuseExisting: booleanSchema(),
      installDependenciesIfNeeded: booleanSchema(),
      runtimeFilePath: stringSchema(),
      logPath: stringSchema(),
      metroHost: stringSchema(),
      metroPort: integerSchema(),
      bundleUrl: stringSchema(),
      timeoutMs: integerSchema(),
    },
    ['action'],
    (client, input) =>
      input.action === 'prepare'
        ? client.metro.prepare(toMetroPrepareOptions(input))
        : client.metro.reload(toMetroReloadOptions(input)),
  ),
] as const;

function defineClientCommand<
  TInput extends object = Record<string, unknown>,
  const TName extends string = string,
>(
  name: TName,
  description: string,
  properties: Record<string, JsonSchema>,
  required: readonly string[],
  run: (client: AgentDeviceClient, input: TInput) => Promise<unknown>,
) {
  return defineSemanticCommand({
    name,
    description,
    inputSchema: commandInputSchema(properties, required),
    outputSchema: commandResultSchema(),
    readInput: (input) => readClientOptions<TInput>(input),
    run,
  });
}

function withoutApp(input: AppCloseOptions & { shutdown?: boolean }): { shutdown?: boolean } {
  const { app: _app, ...rest } = input;
  return rest;
}

function toMetroPrepareOptions(input: MetroInput): MetroPrepareOptions {
  return {
    projectRoot: input.projectRoot,
    kind: input.kind,
    publicBaseUrl: input.publicBaseUrl,
    proxyBaseUrl: input.proxyBaseUrl,
    bearerToken: input.bearerToken,
    bridgeScope: input.bridgeScope,
    port: input.port,
    listenHost: input.listenHost,
    statusHost: input.statusHost,
    startupTimeoutMs: input.startupTimeoutMs,
    probeTimeoutMs: input.probeTimeoutMs,
    reuseExisting: input.reuseExisting,
    installDependenciesIfNeeded: input.installDependenciesIfNeeded,
    runtimeFilePath: input.runtimeFilePath,
  };
}

function toMetroReloadOptions(input: MetroInput): MetroReloadOptions {
  return {
    metroHost: input.metroHost,
    metroPort: input.metroPort,
    bundleUrl: input.bundleUrl,
    timeoutMs: input.timeoutMs,
  };
}

function pointSchema(): JsonSchema {
  return {
    type: 'object',
    properties: { x: numberSchema(), y: numberSchema() },
    required: ['x', 'y'],
    additionalProperties: false,
  };
}

function elementTargetSchema(): JsonSchema {
  return {
    oneOf: [
      {
        type: 'object',
        properties: { kind: { type: 'string', const: 'ref' }, ref: stringSchema() },
        required: ['kind', 'ref'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { kind: { type: 'string', const: 'selector' }, selector: stringSchema() },
        required: ['kind', 'selector'],
        additionalProperties: false,
      },
    ],
  };
}

function longPressProperties(): Record<string, JsonSchema> {
  return {
    target: {
      oneOf: [
        ...((elementTargetSchema().oneOf ?? []) as JsonSchema[]),
        {
          type: 'object',
          properties: {
            kind: { type: 'string', const: 'point' },
            x: numberSchema(),
            y: numberSchema(),
          },
          required: ['kind', 'x', 'y'],
          additionalProperties: false,
        },
      ],
    },
    durationMs: integerSchema(),
    depth: integerSchema(),
    scope: stringSchema(),
    raw: booleanSchema(),
  };
}

function waitInputToOptions(input: Record<string, unknown>): WaitCommandOptions {
  optionalEnum(input, 'kind', WAIT_KIND_VALUES);
  const options = { ...input };
  delete options.kind;
  return options as WaitCommandOptions & { kind?: never };
}

function targetInputToOptions<TInput extends { target?: unknown }>(
  input: TInput,
): Omit<TInput, 'target'> {
  const { target, ...rest } = input;
  return { ...rest, ...semanticTargetToClientTarget(target) } as Omit<TInput, 'target'>;
}

function elementTargetInputToOptions(input: GetOptions & { target?: unknown }): GetOptions {
  const { target, ...rest } = input;
  return { ...rest, ...semanticTargetToClientTarget(target) } as GetOptions;
}

function semanticTargetToClientTarget(target: unknown): Record<string, unknown> {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('Expected target to be an object.');
  }
  const record = target as Record<string, unknown>;
  if (record.kind === 'ref') return { ref: record.ref, label: record.label };
  if (record.kind === 'selector') return { selector: record.selector };
  if (record.kind === 'point') return { x: record.x, y: record.y };
  throw new Error('Expected target kind to be ref, selector, or point.');
}
