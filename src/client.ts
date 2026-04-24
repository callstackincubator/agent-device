import { sendToDaemon } from './daemon-client.ts';
import { prepareMetroRuntime } from './client-metro.ts';
import { CLIENT_COMMANDS } from './client-command-registry.ts';
import { createAgentDeviceCommandClient, type PreparedClientCommand } from './client-commands.ts';
import { throwDaemonError } from './daemon-error.ts';
import {
  buildFlags,
  buildMeta,
  normalizeDeployResult,
  normalizeDevice,
  normalizeInstallFromSourceResult,
  normalizeMaterializationReleaseResult,
  normalizeOpenDevice,
  readScreenshotOverlayRefs,
  normalizeRuntimeHints,
  normalizeSession,
  normalizeStartupSample,
  readNullableString,
  readOptionalString,
  readRequiredString,
  readSnapshotNodes,
  resolveSessionName,
} from './client-normalizers.ts';
import type {
  AgentDeviceClient,
  AgentDeviceClientConfig,
  AgentDeviceDaemonTransport,
  AppPushOptions,
  AppTriggerEventOptions,
  AppCloseOptions,
  AppDeployOptions,
  AppInstallFromSourceOptions,
  AppListOptions,
  AppOpenOptions,
  CaptureScreenshotOptions,
  CaptureSnapshotOptions,
  CaptureSnapshotResult,
  CommandRequestResult,
  ElementTarget,
  EnsureSimulatorOptions,
  FindOptions,
  InteractionTarget,
  InternalRequestOptions,
  Lease,
  MaterializationReleaseOptions,
  MetroPrepareOptions,
  NetworkOptions,
} from './client-types.ts';

export function createAgentDeviceClient(
  config: AgentDeviceClientConfig = {},
  deps: { transport?: AgentDeviceDaemonTransport } = {},
): AgentDeviceClient {
  const transport = deps.transport ?? sendToDaemon;

  const execute = async (
    command: string,
    positionals: string[] = [],
    options: InternalRequestOptions = {},
  ): Promise<Record<string, unknown>> => {
    const merged = mergeClientOptions(config, options);
    const response = await transport({
      session: resolveSessionName(merged.session),
      command,
      positionals,
      flags: buildFlags(merged),
      runtime: merged.runtime,
      meta: buildMeta(merged),
    });
    if (!response.ok) {
      throwDaemonError(response.error);
    }
    return (response.data ?? {}) as Record<string, unknown>;
  };

  const listSessions = async (options = {}) => {
    const data = await execute('session_list', [], options);
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions.map(normalizeSession);
  };

  const executePreparedCommand = async <T>(prepared: PreparedClientCommand): Promise<T> =>
    (await execute(prepared.command, prepared.positionals, prepared.options)) as T;

  const executeCommandRequest = async (
    command: string,
    positionals: string[] = [],
    options: InternalRequestOptions = {},
  ): Promise<CommandRequestResult> =>
    (await execute(command, positionals, options)) as CommandRequestResult;

  const resolveRequestSession = (options: InternalRequestOptions = {}) =>
    resolveSessionName(mergeClientOptions(config, options).session);

  return {
    command: createAgentDeviceCommandClient(executePreparedCommand),
    devices: {
      list: async (options = {}) => {
        const data = await execute(CLIENT_COMMANDS.devices, [], options);
        const devices = Array.isArray(data.devices) ? data.devices : [];
        return devices.map(normalizeDevice);
      },
      boot: async (options = {}) => await executeCommandRequest(CLIENT_COMMANDS.boot, [], options),
    },
    sessions: {
      list: async (options = {}) => await listSessions(options),
      close: async (options = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute('close', [], options);
        const shutdown = data.shutdown;
        return {
          session,
          shutdown:
            typeof shutdown === 'object' && shutdown !== null
              ? (shutdown as Record<string, unknown>)
              : undefined,
          identifiers: { session },
        };
      },
    },
    simulators: {
      ensure: async (options: EnsureSimulatorOptions) => {
        const { runtime, ...rest } = options;
        const data = await execute('ensure-simulator', [], {
          ...rest,
          simulatorRuntimeId: runtime,
        });
        const udid = readRequiredString(data, 'udid');
        const device = readRequiredString(data, 'device');
        return {
          udid,
          device,
          runtime: readRequiredString(data, 'runtime'),
          created: data.created === true,
          booted: data.booted === true,
          iosSimulatorDeviceSet: readNullableString(data, 'ios_simulator_device_set'),
          identifiers: {
            deviceId: udid,
            deviceName: device,
            udid,
          },
        };
      },
    },
    apps: {
      install: async (options: AppDeployOptions) =>
        normalizeDeployResult(
          await execute('install', [options.app, options.appPath], options),
          resolveRequestSession(options),
        ),
      reinstall: async (options: AppDeployOptions) =>
        normalizeDeployResult(
          await execute('reinstall', [options.app, options.appPath], options),
          resolveRequestSession(options),
        ),
      installFromSource: async (options: AppInstallFromSourceOptions) =>
        normalizeInstallFromSourceResult(
          await execute('install_source', [], {
            ...options,
            installSource: options.source,
            retainMaterializedPaths: options.retainPaths,
            materializedPathRetentionMs: options.retentionMs,
          }),
          resolveRequestSession(options),
        ),
      list: async (options: AppListOptions = {}) => {
        const data = await execute(CLIENT_COMMANDS.apps, [], options);
        return Array.isArray(data.apps)
          ? data.apps.filter((app): app is string => typeof app === 'string')
          : [];
      },
      open: async (options: AppOpenOptions) => {
        const session = resolveRequestSession(options);
        const positionals = options.app
          ? options.url
            ? [options.app, options.url]
            : [options.app]
          : [];
        const data = await execute('open', positionals, options);
        const device = normalizeOpenDevice(data);
        const appBundleId = readOptionalString(data, 'appBundleId');
        const appId = appBundleId;
        return {
          session,
          appName: readOptionalString(data, 'appName'),
          appBundleId,
          appId,
          startup: normalizeStartupSample(data.startup),
          runtime: normalizeRuntimeHints(data.runtime),
          device,
          identifiers: {
            session,
            deviceId: device?.id,
            deviceName: device?.name,
            udid: device?.ios?.udid,
            serial: device?.android?.serial,
            appId,
            appBundleId,
          },
        };
      },
      close: async (options: AppCloseOptions = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute('close', options.app ? [options.app] : [], options);
        const shutdown = data.shutdown;
        return {
          session,
          closedApp: options.app,
          shutdown:
            typeof shutdown === 'object' && shutdown !== null
              ? (shutdown as Record<string, unknown>)
              : undefined,
          identifiers: { session },
        };
      },
      push: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.push,
          [options.app, stringifyPayload(options.payload)],
          options,
        ),
      triggerEvent: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.triggerAppEvent,
          triggerEventPositionals(options),
          options,
        ),
    },
    materializations: {
      release: async (options: MaterializationReleaseOptions) =>
        normalizeMaterializationReleaseResult(
          await execute('release_materialized_paths', [], {
            ...options,
            materializationId: options.materializationId,
          }),
        ),
    },
    leases: {
      allocate: async (options) =>
        normalizeLease(
          await execute('lease_allocate', [], {
            ...options,
            leaseId: undefined,
            leaseTtlMs: options.ttlMs,
          }),
        ),
      heartbeat: async (options) =>
        normalizeLease(
          await execute('lease_heartbeat', [], {
            ...options,
            leaseTtlMs: options.ttlMs,
          }),
        ),
      release: async (options) => {
        const data = await execute('lease_release', [], options);
        return { released: data.released === true };
      },
    },
    metro: {
      prepare: async (options: MetroPrepareOptions) =>
        await prepareMetroRuntime({
          projectRoot: options.projectRoot ?? config.cwd,
          kind: options.kind,
          publicBaseUrl: options.publicBaseUrl,
          proxyBaseUrl: options.proxyBaseUrl,
          proxyBearerToken: options.bearerToken,
          bridgeScope: options.bridgeScope,
          launchUrl: options.launchUrl,
          companionProfileKey: options.companionProfileKey,
          companionConsumerKey: options.companionConsumerKey,
          metroPort: options.port,
          listenHost: options.listenHost,
          statusHost: options.statusHost,
          startupTimeoutMs: options.startupTimeoutMs,
          probeTimeoutMs: options.probeTimeoutMs,
          reuseExisting: options.reuseExisting,
          installDependenciesIfNeeded: options.installDependenciesIfNeeded,
          runtimeFilePath: options.runtimeFilePath,
          logPath: options.logPath,
        }),
    },
    capture: {
      snapshot: async (options: CaptureSnapshotOptions = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute(CLIENT_COMMANDS.snapshot, [], options);
        const appBundleId = readOptionalString(data, 'appBundleId');
        const visibility =
          typeof data.visibility === 'object' && data.visibility !== null
            ? (data.visibility as CaptureSnapshotResult['visibility'])
            : undefined;
        return {
          nodes: readSnapshotNodes(data.nodes),
          truncated: data.truncated === true,
          appName: readOptionalString(data, 'appName'),
          appBundleId,
          ...(visibility ? { visibility } : {}),
          warnings: Array.isArray(data.warnings)
            ? data.warnings.filter((entry): entry is string => typeof entry === 'string')
            : undefined,
          identifiers: {
            session,
            appId: appBundleId,
            appBundleId,
          },
        };
      },
      screenshot: async (options: CaptureScreenshotOptions = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute(CLIENT_COMMANDS.screenshot, options.path ? [options.path] : [], {
          ...options,
          screenshotFullscreen: options.fullscreen,
          screenshotMaxSize: options.maxSize,
        });
        return {
          path: readRequiredString(data, 'path'),
          overlayRefs: readScreenshotOverlayRefs(data),
          identifiers: { session },
        };
      },
      diff: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.diff, [options.kind], {
          ...options,
          interactiveOnly: options.interactiveOnly,
          compact: options.compact,
          depth: options.depth,
          scope: options.scope,
          raw: options.raw,
        }),
    },
    interactions: {
      click: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.click, targetPositionals(options), {
          ...options,
          clickButton: options.button,
        }),
      press: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.press, targetPositionals(options), options),
      longPress: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.longPress,
          [String(options.x), String(options.y), ...optionalNumber(options.durationMs)],
          options,
        ),
      swipe: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.swipe,
          [
            String(options.from.x),
            String(options.from.y),
            String(options.to.x),
            String(options.to.y),
            ...optionalNumber(options.durationMs),
          ],
          options,
        ),
      focus: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.focus,
          [String(options.x), String(options.y)],
          options,
        ),
      type: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.type, [options.text], options),
      fill: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.fill,
          [...targetPositionals(options), options.text],
          options,
        ),
      scroll: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.scroll,
          [options.direction, ...optionalNumber(options.amount)],
          options,
        ),
      pinch: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.pinch,
          [String(options.scale), ...optionalNumber(options.x), ...optionalNumber(options.y)],
          options,
        ),
      get: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.get,
          [options.format, ...elementPositionals(options)],
          options,
        ),
      is: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.is,
          [
            options.predicate,
            options.selector,
            ...(options.predicate === 'text' ? [options.value] : []),
          ],
          options,
        ),
      find: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.find, findPositionals(options), {
          ...options,
          findFirst: options.first,
          findLast: options.last,
        }),
    },
    replay: {
      run: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.replay, [options.path], {
          ...options,
          replayUpdate: options.update,
          replayEnv: options.env,
          replayShellEnv: collectReplayClientShellEnv(process.env),
        }),
      test: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.test, options.paths, {
          ...options,
          replayUpdate: options.update,
          replayEnv: options.env,
          replayShellEnv: collectReplayClientShellEnv(process.env),
        }),
    },
    batch: {
      run: async (options) =>
        await executeCommandRequest(CLIENT_COMMANDS.batch, [], {
          ...options,
          batchSteps: options.steps,
          batchOnError: options.onError,
          batchMaxSteps: options.maxSteps,
        }),
    },
    observability: {
      perf: async (options = {}) => await executeCommandRequest(CLIENT_COMMANDS.perf, [], options),
      logs: async (options = {}) =>
        await executeCommandRequest(CLIENT_COMMANDS.logs, logsPositionals(options), options),
      network: async (options = {}) =>
        await executeCommandRequest(CLIENT_COMMANDS.network, networkPositionals(options), {
          ...options,
          networkInclude: options.include,
        }),
    },
    recording: {
      record: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.record,
          [options.action, ...optionalString(options.path)],
          options,
        ),
      trace: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.trace,
          [options.action, ...optionalString(options.path)],
          options,
        ),
    },
    settings: {
      update: async (options) =>
        await executeCommandRequest(
          CLIENT_COMMANDS.settings,
          [
            options.setting,
            options.state,
            ...('permission' in options ? [options.permission] : []),
            ...('mode' in options && options.mode ? [options.mode] : []),
          ],
          options,
        ),
    },
  };
}

function targetPositionals(options: InteractionTarget): string[] {
  if (options.ref !== undefined) return [options.ref, ...optionalString(options.label)];
  if (options.selector !== undefined) return [options.selector];
  return [String(options.x), String(options.y)];
}

function elementPositionals(options: ElementTarget): string[] {
  if (options.ref !== undefined) return [options.ref, ...optionalString(options.label)];
  return [options.selector];
}

function stringifyPayload(payload: AppPushOptions['payload']): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function triggerEventPositionals(options: AppTriggerEventOptions): string[] {
  return [options.event, ...(options.payload ? [JSON.stringify(options.payload)] : [])];
}

function findPositionals(options: FindOptions): string[] {
  const args =
    options.locator && options.locator !== 'any'
      ? [options.locator, options.query]
      : [options.query];
  switch (options.action) {
    case undefined:
    case 'click':
    case 'focus':
    case 'exists':
      return options.action ? [...args, options.action] : args;
    case 'getText':
      return [...args, 'get', 'text'];
    case 'getAttrs':
      return [...args, 'get', 'attrs'];
    case 'wait':
      return [...args, 'wait', ...optionalNumber(options.timeoutMs)];
    case 'fill':
    case 'type':
      return [...args, options.action, options.value];
  }
}

function logsPositionals(options: { action?: string; message?: string }): string[] {
  return [options.action ?? 'path', ...optionalString(options.message)];
}

function networkPositionals(options: NetworkOptions): string[] {
  return [...(options.action ? [options.action] : []), ...optionalNumber(options.limit)];
}

function optionalString(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

function optionalNumber(value: number | undefined): string[] {
  return value === undefined ? [] : [String(value)];
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

function mergeClientOptions(
  config: AgentDeviceClientConfig,
  options: InternalRequestOptions,
): InternalRequestOptions {
  return { ...config, ...options };
}

function normalizeLease(data: Record<string, unknown>): Lease {
  const rawLease = data.lease;
  if (!rawLease || typeof rawLease !== 'object' || Array.isArray(rawLease)) {
    throw new Error('Invalid lease response from daemon');
  }
  const lease = rawLease as Record<string, unknown>;
  return {
    leaseId: readRequiredString(lease, 'leaseId'),
    tenantId: readRequiredString(lease, 'tenantId'),
    runId: readRequiredString(lease, 'runId'),
    backend: readRequiredString(lease, 'backend') as Lease['backend'],
    createdAt: typeof lease.createdAt === 'number' ? lease.createdAt : undefined,
    heartbeatAt: typeof lease.heartbeatAt === 'number' ? lease.heartbeatAt : undefined,
    expiresAt: typeof lease.expiresAt === 'number' ? lease.expiresAt : undefined,
  };
}

export type {
  AgentDeviceClient,
  AgentDeviceClientConfig,
  AgentDeviceCommandClient,
  AgentDeviceDaemonTransport,
  AgentDeviceDevice,
  AgentDeviceIdentifiers,
  AgentDeviceRequestOverrides,
  AgentDeviceSelectionOptions,
  AgentDeviceSession,
  AgentDeviceSessionDevice,
  AlertCommandOptions,
  AlertCommandResult,
  AppPushOptions,
  AppStateCommandOptions,
  AppStateCommandResult,
  AppTriggerEventOptions,
  AppCloseOptions,
  AppCloseResult,
  AppDeployOptions,
  AppDeployResult,
  AppInstallFromSourceOptions,
  AppInstallFromSourceResult,
  AppListOptions,
  AppOpenOptions,
  AppOpenResult,
  AppSwitcherCommandOptions,
  AppSwitcherCommandResult,
  BackCommandOptions,
  BackCommandResult,
  CaptureScreenshotOptions,
  CaptureScreenshotResult,
  CaptureSnapshotOptions,
  CaptureSnapshotResult,
  CaptureDiffOptions,
  ClipboardCommandOptions,
  ClipboardCommandResult,
  CommandRequestResult,
  BatchRunOptions,
  BatchStep,
  ClickOptions,
  ElementTarget,
  DeviceBootOptions,
  EnsureSimulatorOptions,
  EnsureSimulatorResult,
  FillOptions,
  FindLocator,
  FindOptions,
  FocusOptions,
  GetOptions,
  HomeCommandOptions,
  HomeCommandResult,
  IsOptions,
  InteractionTarget,
  KeyboardCommandOptions,
  KeyboardCommandResult,
  Lease,
  LeaseAllocateOptions,
  LeaseOptions,
  LeaseScopedOptions,
  LogsOptions,
  LongPressOptions,
  MaterializationReleaseOptions,
  MaterializationReleaseResult,
  MetroPrepareOptions,
  MetroPrepareResult,
  NetworkOptions,
  PerfOptions,
  PermissionTarget,
  PinchOptions,
  PressOptions,
  RecordOptions,
  ReplayRunOptions,
  ReplayTestOptions,
  RotateCommandOptions,
  RotateCommandResult,
  ScrollOptions,
  SessionCloseResult,
  SettingsUpdateOptions,
  StartupPerfSample,
  SwipeOptions,
  TraceOptions,
  TypeTextOptions,
  WaitCommandOptions,
  WaitCommandResult,
} from './client-types.ts';
