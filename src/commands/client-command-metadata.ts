import type { MetroPrepareOptions, RecordOptions } from '../client-types.ts';
import { NETWORK_INCLUDE_MODES, type DaemonInstallSource } from '../contracts.ts';
import { ALERT_ACTIONS } from '../alert-contract.ts';
import { BACK_MODES } from '../core/back-mode.ts';
import { DEVICE_ROTATIONS } from '../core/device-rotation.ts';
import { SESSION_SURFACES } from '../core/session-surface.ts';
import { LOG_ACTION_VALUES } from './log-command-contract.ts';
import { requireCommandDescription } from './command-descriptions.ts';
import {
  booleanField,
  booleanSchema,
  enumField,
  integerField,
  integerSchema,
  jsonSchemaField,
  looseObjectField,
  looseObjectSchema,
  numberField,
  requiredField,
  stringArrayField,
  stringField,
  stringSchema,
  type CommandFieldMap,
} from './command-input.ts';
import { defineFieldCommandMetadata } from './field-command-contract.ts';
import { PERF_ACTION_VALUES, PERF_AREA_VALUES } from './perf-command-contract.ts';
import { WAIT_KIND_VALUES } from './wait-command-contract.ts';

const CLIPBOARD_ACTION_VALUES = ['read', 'write'] as const;
const NETWORK_ACTION_VALUES = ['dump', 'log'] as const;
const START_STOP_VALUES = ['start', 'stop'] as const;
const REACT_NATIVE_ACTION_VALUES = ['dismiss-overlay'] as const;
const METRO_ACTION_VALUES = ['prepare', 'reload'] as const;
const PREPARE_ACTION_VALUES = ['ios-runner'] as const;

export const clientCommandMetadata = [
  defineClientCommandMetadata('devices', {}),
  defineClientCommandMetadata('boot', {
    headless: booleanField('Boot without showing simulator UI when supported.'),
  }),
  defineClientCommandMetadata('shutdown', {}),
  defineClientCommandMetadata('prepare', {
    action: requiredField(enumField(PREPARE_ACTION_VALUES)),
    timeoutMs: integerField('Maximum wall-clock time for the prepare command.'),
  }),
  defineClientCommandMetadata('apps', {
    appsFilter: enumField(['user-installed', 'all']),
  }),
  defineClientCommandMetadata('session', {
    action: enumField(
      ['list', 'state-dir'],
      'list shows active sessions; state-dir prints the resolved daemon state directory without contacting the daemon.',
    ),
  }),
  defineClientCommandMetadata('open', {
    app: stringField('App name, bundle id, package, or URL.'),
    url: stringField('Optional URL passed with an app shell.'),
    surface: enumField(SESSION_SURFACES),
    activity: stringField('Android activity name.'),
    launchConsole: stringField('Launch console mode.'),
    launchArgs: stringArrayField(
      'Launch arguments forwarded verbatim to the platform launch command.',
    ),
    relaunch: booleanField('Force relaunch.'),
    saveScript: jsonSchemaField<boolean | string>({ oneOf: [booleanSchema(), stringSchema()] }),
    deviceHub: booleanField('Use Xcode Device Hub when surfacing Apple simulators.'),
    noRecord: booleanField('Do not record this action.'),
  }),
  defineClientCommandMetadata('close', {
    app: stringField('Optional app to close.'),
    shutdown: booleanField('Shutdown the session/device where supported.'),
    saveScript: jsonSchemaField<boolean | string>({ oneOf: [booleanSchema(), stringSchema()] }),
  }),
  defineClientCommandMetadata('install', {
    app: requiredField(stringField()),
    appPath: requiredField(stringField('Path to app binary.')),
  }),
  defineClientCommandMetadata('reinstall', {
    app: requiredField(stringField()),
    appPath: requiredField(stringField('Path to app binary.')),
  }),
  defineClientCommandMetadata('install-from-source', {
    source: requiredField(
      jsonSchemaField<DaemonInstallSource>(looseObjectSchema('Install source object.')),
    ),
    retainPaths: booleanField(),
    retentionMs: integerField(),
  }),
  defineClientCommandMetadata('push', {
    app: requiredField(stringField()),
    payload: requiredField(
      jsonSchemaField<string | Record<string, unknown>>({
        oneOf: [stringSchema(), looseObjectSchema()],
      }),
    ),
  }),
  defineClientCommandMetadata('trigger-app-event', {
    event: requiredField(stringField()),
    payload: looseObjectField(),
  }),
  defineClientCommandMetadata('snapshot', {
    interactiveOnly: booleanField(),
    compact: booleanField(),
    depth: integerField(),
    scope: stringField(),
    raw: booleanField(),
    forceFull: booleanField(),
    timeoutMs: integerField('Maximum wall-clock time for the snapshot command.'),
  }),
  defineClientCommandMetadata('screenshot', {
    path: stringField('Output path.'),
    overlayRefs: booleanField(),
    fullscreen: booleanField(),
    maxSize: integerField(),
    stabilize: booleanField(),
    surface: enumField(SESSION_SURFACES),
  }),
  defineClientCommandMetadata('diff', {
    kind: requiredField(jsonSchemaField<'snapshot'>({ type: 'string', const: 'snapshot' })),
    out: stringField(),
    interactiveOnly: booleanField(),
    compact: booleanField(),
    depth: integerField(),
    scope: stringField(),
    raw: booleanField(),
  }),
  defineClientCommandMetadata('wait', {
    kind: enumField(WAIT_KIND_VALUES),
    durationMs: integerField(),
    text: stringField(),
    ref: stringField(),
    selector: stringField(),
    timeoutMs: integerField(),
    depth: integerField(),
    scope: stringField(),
    raw: booleanField(),
  }),
  defineClientCommandMetadata('alert', {
    action: enumField(ALERT_ACTIONS),
    timeoutMs: integerField(),
  }),
  defineClientCommandMetadata('appstate', {}),
  defineClientCommandMetadata('back', {
    mode: enumField(BACK_MODES),
  }),
  defineClientCommandMetadata('home', {}),
  defineClientCommandMetadata('rotate', {
    orientation: requiredField(enumField(DEVICE_ROTATIONS)),
  }),
  defineClientCommandMetadata('app-switcher', {}),
  defineClientCommandMetadata('keyboard', {
    action: enumField(['status', 'dismiss']),
  }),
  defineClientCommandMetadata('clipboard', {
    action: requiredField(enumField(CLIPBOARD_ACTION_VALUES)),
    text: stringField(),
  }),
  defineClientCommandMetadata('react-native', {
    action: requiredField(enumField(REACT_NATIVE_ACTION_VALUES)),
  }),
  defineClientCommandMetadata('replay', {
    path: requiredField(stringField()),
    update: booleanField(),
    backend: stringField(),
    maestro: booleanField(),
    env: stringArrayField(),
  }),
  defineClientCommandMetadata('test', {
    paths: requiredField(stringArrayField()),
    update: booleanField(),
    backend: stringField(),
    maestro: booleanField(),
    env: stringArrayField(),
    failFast: booleanField(),
    timeoutMs: integerField(),
    retries: integerField(),
    recordVideo: booleanField(),
    artifactsDir: stringField(),
    reportJunit: stringField(),
    shardAll: integerField(),
    shardSplit: integerField(),
  }),
  defineClientCommandMetadata('perf', {
    area: enumField(PERF_AREA_VALUES),
    action: enumField(PERF_ACTION_VALUES),
  }),
  defineClientCommandMetadata('logs', {
    action: enumField(LOG_ACTION_VALUES),
    message: stringField(),
    restart: booleanField(),
  }),
  defineClientCommandMetadata('network', {
    action: enumField(NETWORK_ACTION_VALUES),
    limit: integerField(),
    include: enumField(NETWORK_INCLUDE_MODES),
  }),
  defineClientCommandMetadata('record', {
    action: requiredField(enumField(START_STOP_VALUES)),
    path: stringField(),
    fps: integerField(),
    quality: jsonSchemaField<RecordOptions['quality']>(integerSchema()),
    hideTouches: booleanField(),
  }),
  defineClientCommandMetadata('trace', {
    action: requiredField(enumField(START_STOP_VALUES)),
    path: stringField(),
  }),
  defineClientCommandMetadata('settings', {
    setting: requiredField(stringField()),
    state: requiredField(stringField()),
    app: stringField(),
    latitude: numberField(),
    longitude: numberField(),
    permission: stringField(),
    mode: enumField(['full', 'limited']),
  }),
  defineClientCommandMetadata('metro', {
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
  }),
] as const;

function defineClientCommandMetadata<
  const TName extends string,
  const TFields extends CommandFieldMap,
>(name: TName, fields: TFields) {
  return defineFieldCommandMetadata(name, requireCommandDescription(name), fields);
}
