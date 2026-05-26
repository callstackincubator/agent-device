import type {
  AgentDeviceClient,
  AppCloseOptions,
  ClipboardCommandOptions,
  FindOptions,
  GetOptions,
  IsOptions,
  LongPressOptions,
  MetroPrepareOptions,
  MetroPrepareResult,
  MetroReloadOptions,
  MetroReloadResult,
  RecordOptions,
  SettingsUpdateOptions,
  SwipeOptions,
  WaitCommandOptions,
} from '../client-types.ts';
import type { DaemonInstallSource } from '../contracts.ts';
import {
  appStateCliOutput,
  appsCliOutput,
  closeCliOutput,
  clipboardCliOutput,
  deployCliOutput,
  devicesCliOutput,
  findCliOutput,
  getCliOutput,
  installFromSourceCliOutput,
  isCliOutput,
  keyboardCliOutput,
  messageCliOutput,
  metroCliOutput,
  openCliOutput,
  recordCliOutput,
  sessionCliOutput,
  snapshotCliOutput,
} from './semantic-client-output.ts';
import { logsCliOutput, networkCliOutput, perfCliOutput } from './semantic-runtime-output.ts';
import {
  defineSemanticCommand,
  type JsonSchema,
  type SemanticCliOutputFormatter,
} from './semantic-contract.ts';
import {
  booleanSchema,
  booleanField,
  commonToClientOptions,
  enumField,
  fieldsInputSchema,
  integerField,
  integerSchema,
  jsonSchemaField,
  looseObjectField,
  looseObjectSchema,
  numberField,
  numberSchema,
  optionalEnum,
  readFieldInput,
  requiredField,
  stringArrayField,
  stringField,
  stringSchema,
  type InferCommandInput,
  type SemanticFieldMap,
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

export const semanticClientCommands = [
  defineFieldCommand(
    'devices',
    'List available devices.',
    {},
    (client, input) => client.devices.list(input),
    {
      formatCliOutput: ({ result }) => devicesCliOutput(result),
    },
  ),
  defineFieldCommand(
    'apps',
    'List installed apps.',
    { appsFilter: enumField(['user-installed', 'all']) },
    (client, input) => client.apps.list(input),
    {
      formatCliOutput: ({ input, result }) =>
        appsCliOutput({ result, appsFilter: input.appsFilter }),
    },
  ),
  defineFieldCommand(
    'session',
    'List active sessions.',
    { action: enumField(['list']) },
    async (client) => ({ sessions: await client.sessions.list() }),
    {
      formatCliOutput: ({ result }) => sessionCliOutput(result),
    },
  ),
  defineFieldCommand(
    'open',
    'Open an app, deep link, URL, or platform surface.',
    {
      app: stringField('App name, bundle id, package, or URL.'),
      url: stringField('Optional URL passed with an app shell.'),
      surface: enumField(SURFACE_VALUES),
      activity: stringField('Android activity name.'),
      launchConsole: stringField('Launch console mode.'),
      relaunch: booleanField('Force relaunch.'),
      saveScript: jsonSchemaField<boolean | string>({ oneOf: [booleanSchema(), stringSchema()] }),
      noRecord: booleanField('Do not record this action.'),
    },
    (client, input) => client.apps.open(input),
    {
      formatCliOutput: ({ result }) => openCliOutput(result),
    },
  ),
  defineFieldCommand(
    'close',
    'Close an app or end the active session.',
    {
      app: stringField('Optional app to close.'),
      shutdown: booleanField('Shutdown the session/device where supported.'),
      saveScript: jsonSchemaField<boolean | string>({ oneOf: [booleanSchema(), stringSchema()] }),
    },
    (client, input) =>
      input.app ? client.apps.close(input) : client.sessions.close(withoutApp(input)),
    {
      formatCliOutput: ({ result }) => closeCliOutput(result),
    },
  ),
  defineFieldCommand(
    'install',
    'Install an app binary.',
    {
      app: requiredField(stringField()),
      appPath: requiredField(stringField('Path to app binary.')),
    },
    (client, input) => client.apps.install(input),
    {
      formatCliOutput: ({ result }) => deployCliOutput(result),
    },
  ),
  defineFieldCommand(
    'reinstall',
    'Reinstall an app binary.',
    {
      app: requiredField(stringField()),
      appPath: requiredField(stringField('Path to app binary.')),
    },
    (client, input) => client.apps.reinstall(input),
    {
      formatCliOutput: ({ result }) => deployCliOutput(result),
    },
  ),
  defineFieldCommand(
    'install-from-source',
    'Install an app from a structured source.',
    {
      source: requiredField(
        jsonSchemaField<DaemonInstallSource>(looseObjectSchema('Install source object.')),
      ),
      retainPaths: booleanField(),
      retentionMs: integerField(),
    },
    (client, input) => client.apps.installFromSource(input),
    {
      formatCliOutput: ({ result }) => installFromSourceCliOutput(result),
    },
  ),
  defineFieldCommand(
    'push',
    'Deliver a push payload.',
    {
      app: requiredField(stringField()),
      payload: requiredField(
        jsonSchemaField<string | Record<string, unknown>>({
          oneOf: [stringSchema(), looseObjectSchema()],
        }),
      ),
    },
    (client, input) => client.apps.push(input),
  ),
  defineFieldCommand(
    'trigger-app-event',
    'Trigger an app-defined event.',
    { event: requiredField(stringField()), payload: looseObjectField() },
    (client, input) => client.apps.triggerEvent(input),
  ),
  defineFieldCommand(
    'snapshot',
    'Capture an accessibility snapshot.',
    {
      interactiveOnly: booleanField(),
      compact: booleanField(),
      depth: integerField(),
      scope: stringField(),
      raw: booleanField(),
      forceFull: booleanField(),
    },
    (client, input) => client.capture.snapshot(input),
    {
      formatCliOutput: ({ input, result }) =>
        snapshotCliOutput({
          result,
          raw: input.raw,
          interactiveOnly: input.interactiveOnly,
        }),
    },
  ),
  defineFieldCommand(
    'screenshot',
    'Capture a screenshot.',
    {
      path: stringField('Output path.'),
      overlayRefs: booleanField(),
      fullscreen: booleanField(),
      maxSize: integerField(),
      stabilize: booleanField(),
      surface: enumField(SURFACE_VALUES),
    },
    (client, input) => client.capture.screenshot(input),
  ),
  defineFieldCommand(
    'diff',
    'Diff accessibility snapshots.',
    {
      kind: requiredField(jsonSchemaField<'snapshot'>({ type: 'string', const: 'snapshot' })),
      out: stringField(),
      interactiveOnly: booleanField(),
      compact: booleanField(),
      depth: integerField(),
      scope: stringField(),
      raw: booleanField(),
    },
    (client, input) => client.capture.diff(input),
  ),
  defineFieldCommand(
    'wait',
    'Wait for duration, text, ref, or selector.',
    {
      kind: enumField(WAIT_KIND_VALUES),
      durationMs: integerField(),
      text: stringField(),
      ref: stringField(),
      selector: stringField(),
      timeoutMs: integerField(),
      depth: integerField(),
      scope: stringField(),
      raw: booleanField(),
    },
    (client, input) => client.command.wait(waitInputToOptions(input)),
    {
      formatCliOutput: ({ result }) => messageCliOutput(result),
    },
  ),
  defineFieldCommand(
    'alert',
    'Inspect or handle platform alerts.',
    { action: enumField(ALERT_ACTION_VALUES), timeoutMs: integerField() },
    (client, input) => client.command.alert(input),
    {
      formatCliOutput: ({ result }) => messageCliOutput(result),
    },
  ),
  defineFieldCommand(
    'appstate',
    'Show foreground app or activity.',
    {},
    (client, input) => client.command.appState(input),
    {
      formatCliOutput: ({ result }) => appStateCliOutput(result),
    },
  ),
  defineFieldCommand(
    'back',
    'Navigate back.',
    { mode: enumField(BACK_MODE_VALUES) },
    (client, input) => client.command.back(input),
    {
      formatCliOutput: ({ result }) => messageCliOutput(result),
    },
  ),
  defineFieldCommand(
    'home',
    'Go to the home screen.',
    {},
    (client, input) => client.command.home(input),
    {
      formatCliOutput: ({ result }) => messageCliOutput(result),
    },
  ),
  defineFieldCommand(
    'rotate',
    'Rotate device orientation.',
    { orientation: requiredField(enumField(ORIENTATION_VALUES)) },
    (client, input) => client.command.rotate(input),
    {
      formatCliOutput: ({ result }) => messageCliOutput(result),
    },
  ),
  defineFieldCommand(
    'app-switcher',
    'Open the app switcher.',
    {},
    (client, input) => client.command.appSwitcher(input),
    {
      formatCliOutput: ({ result }) => messageCliOutput(result),
    },
  ),
  defineFieldCommand(
    'keyboard',
    'Inspect or dismiss the keyboard.',
    { action: enumField(['status', 'dismiss']) },
    (client, input) => client.command.keyboard(input),
    {
      formatCliOutput: ({ result }) => keyboardCliOutput(result),
    },
  ),
  defineFieldCommand(
    'clipboard',
    'Read or write clipboard text.',
    { action: requiredField(enumField(CLIPBOARD_ACTION_VALUES)), text: stringField() },
    (client, input) => client.command.clipboard(input as ClipboardCommandOptions),
    {
      formatCliOutput: ({ result }) => clipboardCliOutput(result),
    },
  ),
  defineFieldCommand(
    'react-native',
    'Run supported React Native app automation helpers.',
    { action: requiredField(enumField(REACT_NATIVE_ACTION_VALUES)) },
    (client, input) => client.command.reactNative(input),
  ),
  defineFieldCommand(
    'longpress',
    'Long press by ref, selector, or point.',
    {
      target: requiredField(jsonSchemaField(longPressProperties().target)),
      durationMs: integerField(),
      depth: integerField(),
      scope: stringField(),
      raw: booleanField(),
    },
    (client, input) =>
      client.interactions.longPress(targetInputToOptions(input) as LongPressOptions),
  ),
  defineFieldCommand(
    'swipe',
    'Swipe between two points.',
    {
      from: requiredField(jsonSchemaField<SwipeOptions['from']>(pointSchema())),
      to: requiredField(jsonSchemaField<SwipeOptions['to']>(pointSchema())),
      durationMs: integerField(),
      count: integerField(),
      pauseMs: integerField(),
      pattern: enumField(SWIPE_PATTERN_VALUES),
    },
    (client, input) => client.interactions.swipe(input),
  ),
  defineFieldCommand(
    'focus',
    'Focus input at coordinates.',
    { x: requiredField(numberField()), y: requiredField(numberField()) },
    (client, input) => client.interactions.focus(input),
  ),
  defineFieldCommand(
    'type',
    'Type text in the focused field.',
    { text: requiredField(stringField()), delayMs: integerField() },
    (client, input) => client.interactions.type(input),
  ),
  defineFieldCommand(
    'scroll',
    'Scroll in a direction or to an edge.',
    {
      direction: requiredField(enumField(SCROLL_DIRECTION_VALUES)),
      amount: numberField(),
      pixels: integerField(),
    },
    (client, input) => client.interactions.scroll(input),
  ),
  defineFieldCommand(
    'get',
    'Get element text or attributes.',
    {
      format: requiredField(enumField(['text', 'attrs'])),
      target: requiredField(jsonSchemaField<GetOptions['target']>(elementTargetSchema())),
      depth: integerField(),
      scope: stringField(),
      raw: booleanField(),
    },
    (client, input) => client.interactions.get(elementTargetInputToOptions(input)),
    {
      formatCliOutput: ({ input, result }) => getCliOutput({ result, format: input.format }),
    },
  ),
  defineFieldCommand(
    'is',
    'Assert UI state.',
    {
      predicate: requiredField(
        enumField(['visible', 'hidden', 'exists', 'editable', 'selected', 'text']),
      ),
      selector: requiredField(stringField()),
      value: stringField(),
      depth: integerField(),
      scope: stringField(),
      raw: booleanField(),
    },
    (client, input) => client.interactions.is(input as IsOptions),
    {
      formatCliOutput: ({ result }) => isCliOutput(result),
    },
  ),
  defineFieldCommand(
    'find',
    'Find an element and optionally act on it.',
    {
      locator: enumField(FIND_LOCATOR_VALUES),
      query: requiredField(stringField()),
      action: enumField(FIND_ACTION_VALUES),
      value: stringField(),
      timeoutMs: integerField(),
      first: booleanField(),
      last: booleanField(),
      depth: integerField(),
      raw: booleanField(),
    },
    (client, input) => client.interactions.find(input as FindOptions),
    {
      formatCliOutput: ({ result }) => findCliOutput(result),
    },
  ),
  defineFieldCommand(
    'replay',
    'Replay a recorded session.',
    {
      path: requiredField(stringField()),
      update: booleanField(),
      backend: stringField(),
      env: stringArrayField(),
    },
    (client, input) => client.replay.run(input),
  ),
  defineFieldCommand(
    'test',
    'Run one or more .ad scripts.',
    {
      paths: requiredField(stringArrayField()),
      update: booleanField(),
      env: stringArrayField(),
      failFast: booleanField(),
      timeoutMs: integerField(),
      retries: integerField(),
      artifactsDir: stringField(),
      reportJunit: stringField(),
    },
    (client, input) => client.replay.test(input),
  ),
  defineFieldCommand(
    'perf',
    'Show session performance metrics.',
    {},
    (client, input) => client.observability.perf(input),
    {
      formatCliOutput: ({ result }) => perfCliOutput(result),
    },
  ),
  defineFieldCommand(
    'logs',
    'Manage session app logs.',
    { action: enumField(LOG_ACTION_VALUES), message: stringField(), restart: booleanField() },
    (client, input) => client.observability.logs(input),
    {
      formatCliOutput: ({ result }) => logsCliOutput(result),
    },
  ),
  defineFieldCommand(
    'network',
    'Show recent HTTP traffic.',
    {
      action: enumField(NETWORK_ACTION_VALUES),
      limit: integerField(),
      include: enumField(NETWORK_INCLUDE_VALUES),
    },
    (client, input) => client.observability.network(input),
    {
      formatCliOutput: ({ result }) => networkCliOutput(result),
    },
  ),
  defineFieldCommand(
    'record',
    'Start or stop screen recording.',
    {
      action: requiredField(enumField(START_STOP_VALUES)),
      path: stringField(),
      fps: integerField(),
      quality: jsonSchemaField<RecordOptions['quality']>(integerSchema()),
      hideTouches: booleanField(),
    },
    (client, input) => client.recording.record(input as RecordOptions),
    {
      formatCliOutput: ({ result }) => recordCliOutput(result),
    },
  ),
  defineFieldCommand(
    'trace',
    'Start or stop trace capture.',
    { action: requiredField(enumField(START_STOP_VALUES)), path: stringField() },
    (client, input) => client.recording.trace(input),
  ),
  defineFieldCommand(
    'settings',
    'Change OS settings and app permissions.',
    {
      setting: requiredField(stringField()),
      state: requiredField(stringField()),
      latitude: numberField(),
      longitude: numberField(),
      permission: stringField(),
      mode: enumField(['full', 'limited']),
    },
    (client, input) => client.settings.update(input as SettingsUpdateOptions),
  ),
  defineFieldCommand(
    'metro',
    'Prepare Metro runtime or reload React Native apps.',
    {
      action: requiredField(enumField(METRO_ACTION_VALUES)),
      projectRoot: stringField(),
      kind: jsonSchemaField<MetroPrepareOptions['kind']>(stringSchema()),
      publicBaseUrl: stringField(),
      proxyBaseUrl: stringField(),
      bearerToken: stringField(),
      bridgeScope: jsonSchemaField<MetroPrepareOptions['bridgeScope']>({
        type: 'object',
        additionalProperties: true,
      }),
      launchUrl: stringField(),
      port: integerField(),
      listenHost: stringField(),
      statusHost: stringField(),
      startupTimeoutMs: integerField(),
      probeTimeoutMs: integerField(),
      reuseExisting: booleanField(),
      installDependenciesIfNeeded: booleanField(),
      runtimeFilePath: stringField(),
      logPath: stringField(),
      metroHost: stringField(),
      metroPort: integerField(),
      bundleUrl: stringField(),
      timeoutMs: integerField(),
    },
    async (client, input): Promise<MetroPrepareResult | MetroReloadResult> =>
      input.action === 'prepare'
        ? await client.metro.prepare(toMetroPrepareOptions(input))
        : await client.metro.reload(toMetroReloadOptions(input)),
    {
      formatCliOutput: ({ input, result }) => metroCliOutput({ result, action: input.action }),
    },
  ),
] as const;

function defineFieldCommand<
  const TName extends string,
  const TFields extends SemanticFieldMap,
  TResult,
>(
  name: TName,
  description: string,
  fields: TFields,
  run: (client: AgentDeviceClient, input: InferCommandInput<TFields>) => Promise<TResult>,
  options: {
    formatCliOutput?: SemanticCliOutputFormatter<InferCommandInput<TFields>, TResult>;
  } = {},
) {
  return defineSemanticCommand({
    name,
    description,
    inputSchema: fieldsInputSchema(fields),
    readInput: (input) => readFieldInput(input, fields),
    run,
    formatCliOutput: options.formatCliOutput,
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
    bridgeScope: input.bridgeScope ?? metroBridgeScopeFromInput(input),
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

function metroBridgeScopeFromInput(
  input: MetroInput & {
    tenant?: string;
    runId?: string;
    leaseId?: string;
  },
): MetroPrepareOptions['bridgeScope'] {
  return input.tenant && input.runId && input.leaseId
    ? { tenantId: input.tenant, runId: input.runId, leaseId: input.leaseId }
    : undefined;
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

function targetInputToOptions<
  TInput extends InferCommandInput<SemanticFieldMap> & { target?: unknown },
>(input: TInput): Omit<TInput, 'target'> {
  const { target, ...rest } = input;
  return {
    ...rest,
    ...commonToClientOptions(input),
    ...semanticTargetToClientTarget(target),
  } as Omit<TInput, 'target'>;
}

function elementTargetInputToOptions(
  input: InferCommandInput<SemanticFieldMap> & { format: 'text' | 'attrs'; target?: unknown },
): GetOptions {
  const { target, ...rest } = input;
  return {
    ...rest,
    ...commonToClientOptions(input),
    ...semanticTargetToClientTarget(target),
  } as GetOptions;
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
