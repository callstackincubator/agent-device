import type {
  AppCloseOptions,
  ClipboardCommandOptions,
  MetroPrepareOptions,
  MetroPrepareResult,
  MetroReloadOptions,
  MetroReloadResult,
  RecordOptions,
  SettingsUpdateOptions,
  WaitCommandOptions,
} from '../client-types.ts';
import type { DaemonInstallSource } from '../contracts.ts';
import {
  booleanSchema,
  booleanField,
  enumField,
  integerField,
  integerSchema,
  jsonSchemaField,
  looseObjectField,
  looseObjectSchema,
  numberField,
  optionalEnum,
  requiredField,
  stringArrayField,
  stringField,
  stringSchema,
} from './command-input.ts';
import { defineFieldCommand } from './field-command-contract.ts';

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
const LOG_ACTION_VALUES = ['path', 'start', 'stop', 'doctor', 'mark', 'clear'] as const;
const NETWORK_ACTION_VALUES = ['dump', 'log'] as const;
const NETWORK_INCLUDE_VALUES = ['summary', 'headers', 'body', 'all'] as const;
const START_STOP_VALUES = ['start', 'stop'] as const;
const REACT_NATIVE_ACTION_VALUES = ['dismiss-overlay'] as const;
const METRO_ACTION_VALUES = ['prepare', 'reload'] as const;

type MetroInput = { action: 'prepare' | 'reload' } & MetroPrepareOptions & MetroReloadOptions;

export const clientCommandDefinitions = [
  defineFieldCommand('devices', 'List available devices.', {}, (client, input) =>
    client.devices.list(input),
  ),
  defineFieldCommand(
    'boot',
    'Boot or prepare a selected device without using CLI positional arguments.',
    { headless: booleanField('Boot without showing simulator UI when supported.') },
    (client, input) => client.devices.boot(input),
  ),
  defineFieldCommand(
    'apps',
    'List installed apps.',
    { appsFilter: enumField(['user-installed', 'all']) },
    (client, input) => client.apps.list(input),
  ),
  defineFieldCommand(
    'session',
    'List active sessions.',
    { action: enumField(['list']) },
    async (client, { action: _action, ...input }) => ({
      sessions: await client.sessions.list(input),
    }),
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
      launchArgs: stringArrayField('iOS launch arguments forwarded verbatim to the app process.'),
      relaunch: booleanField('Force relaunch.'),
      saveScript: jsonSchemaField<boolean | string>({ oneOf: [booleanSchema(), stringSchema()] }),
      noRecord: booleanField('Do not record this action.'),
    },
    (client, input) => client.apps.open(input),
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
  ),
  defineFieldCommand(
    'install',
    'Install an app binary.',
    {
      app: requiredField(stringField()),
      appPath: requiredField(stringField('Path to app binary.')),
    },
    (client, input) => client.apps.install(input),
  ),
  defineFieldCommand(
    'reinstall',
    'Reinstall an app binary.',
    {
      app: requiredField(stringField()),
      appPath: requiredField(stringField('Path to app binary.')),
    },
    (client, input) => client.apps.reinstall(input),
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
  ),
  defineFieldCommand(
    'alert',
    'Inspect or handle platform alerts.',
    { action: enumField(ALERT_ACTION_VALUES), timeoutMs: integerField() },
    (client, input) => client.command.alert(input),
  ),
  defineFieldCommand('appstate', 'Show foreground app or activity.', {}, (client, input) =>
    client.command.appState(input),
  ),
  defineFieldCommand(
    'back',
    'Navigate back.',
    { mode: enumField(BACK_MODE_VALUES) },
    (client, input) => client.command.back(input),
  ),
  defineFieldCommand('home', 'Go to the home screen.', {}, (client, input) =>
    client.command.home(input),
  ),
  defineFieldCommand(
    'rotate',
    'Rotate device orientation.',
    { orientation: requiredField(enumField(ORIENTATION_VALUES)) },
    (client, input) => client.command.rotate(input),
  ),
  defineFieldCommand('app-switcher', 'Open the app switcher.', {}, (client, input) =>
    client.command.appSwitcher(input),
  ),
  defineFieldCommand(
    'keyboard',
    'Inspect or dismiss the keyboard.',
    { action: enumField(['status', 'dismiss']) },
    (client, input) => client.command.keyboard(input),
  ),
  defineFieldCommand(
    'clipboard',
    'Read or write clipboard text.',
    { action: requiredField(enumField(CLIPBOARD_ACTION_VALUES)), text: stringField() },
    (client, input) => client.command.clipboard(input as ClipboardCommandOptions),
  ),
  defineFieldCommand(
    'react-native',
    'Run supported React Native app automation helpers.',
    { action: requiredField(enumField(REACT_NATIVE_ACTION_VALUES)) },
    (client, input) => client.command.reactNative(input),
  ),
  defineFieldCommand(
    'replay',
    'Replay a recorded session.',
    {
      path: requiredField(stringField()),
      update: booleanField(),
      backend: stringField(),
      maestro: booleanField(),
      env: stringArrayField(),
    },
    (client, input) => client.replay.run(input),
  ),
  defineFieldCommand(
    'test',
    'Run one or more replay scripts.',
    {
      paths: requiredField(stringArrayField()),
      update: booleanField(),
      backend: stringField(),
      maestro: booleanField(),
      env: stringArrayField(),
      failFast: booleanField(),
      timeoutMs: integerField(),
      retries: integerField(),
      artifactsDir: stringField(),
      reportJunit: stringField(),
    },
    (client, input) => client.replay.test(input),
  ),
  defineFieldCommand('perf', 'Show session performance metrics.', {}, (client, input) =>
    client.observability.perf(input),
  ),
  defineFieldCommand(
    'logs',
    'Manage session app logs.',
    { action: enumField(LOG_ACTION_VALUES), message: stringField(), restart: booleanField() },
    (client, input) => client.observability.logs(input),
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
  ),
] as const;

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

function waitInputToOptions(input: Record<string, unknown>): WaitCommandOptions {
  optionalEnum(input, 'kind', WAIT_KIND_VALUES);
  const options = { ...input };
  delete options.kind;
  return options as WaitCommandOptions & { kind?: never };
}
