import { sendToDaemon } from './daemon-client.ts';
import { prepareMetroRuntime, reloadMetro } from './client-metro.ts';
import { INTERNAL_COMMANDS, PUBLIC_COMMANDS } from './command-catalog.ts';
import { createAgentDeviceCommandClient, type PreparedClientCommand } from './client-commands.ts';
import { screenshotFlagsFromOptions } from './commands/capture-screenshot-options.ts';
import {
  elementTargetCodec,
  fillCommandCodec,
  findCommandCodec,
  interactionTargetCodec,
  isCommandCodec,
  settingsCommandCodec,
} from './command-codecs.ts';
import { typeCommandCodec } from './commands/interactions/definition.ts';
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
    const data = await execute(INTERNAL_COMMANDS.sessionList, [], options);
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
        const data = await execute(PUBLIC_COMMANDS.devices, [], options);
        const devices = Array.isArray(data.devices) ? data.devices : [];
        return devices.map(normalizeDevice);
      },
      boot: async (options = {}) => await executeCommandRequest(PUBLIC_COMMANDS.boot, [], options),
    },
    sessions: {
      list: async (options = {}) => await listSessions(options),
      close: async (options = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute(PUBLIC_COMMANDS.close, [], options);
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
    apps: {
      install: async (options: AppDeployOptions) =>
        normalizeDeployResult(
          await execute(PUBLIC_COMMANDS.install, [options.app, options.appPath], options),
          resolveRequestSession(options),
        ),
      reinstall: async (options: AppDeployOptions) =>
        normalizeDeployResult(
          await execute(PUBLIC_COMMANDS.reinstall, [options.app, options.appPath], options),
          resolveRequestSession(options),
        ),
      installFromSource: async (options: AppInstallFromSourceOptions) =>
        normalizeInstallFromSourceResult(
          await execute(INTERNAL_COMMANDS.installSource, [], {
            ...options,
            installSource: options.source,
            retainMaterializedPaths: options.retainPaths,
            materializedPathRetentionMs: options.retentionMs,
          }),
          resolveRequestSession(options),
        ),
      list: async (options: AppListOptions = {}) => {
        const data = await execute(PUBLIC_COMMANDS.apps, [], options);
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
        const data = await execute(PUBLIC_COMMANDS.open, positionals, options);
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
        const data = await execute(
          PUBLIC_COMMANDS.close,
          options.app ? [options.app] : [],
          options,
        );
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
          PUBLIC_COMMANDS.push,
          [options.app, stringifyPayload(options.payload)],
          options,
        ),
      triggerEvent: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.triggerAppEvent,
          triggerEventPositionals(options),
          options,
        ),
    },
    materializations: {
      release: async (options: MaterializationReleaseOptions) =>
        normalizeMaterializationReleaseResult(
          await execute(INTERNAL_COMMANDS.releaseMaterializedPaths, [], {
            ...options,
            materializationId: options.materializationId,
          }),
        ),
    },
    leases: {
      allocate: async (options) =>
        normalizeLease(
          await execute(INTERNAL_COMMANDS.leaseAllocate, [], {
            ...options,
            leaseId: undefined,
            leaseTtlMs: options.ttlMs,
          }),
        ),
      heartbeat: async (options) =>
        normalizeLease(
          await execute(INTERNAL_COMMANDS.leaseHeartbeat, [], {
            ...options,
            leaseTtlMs: options.ttlMs,
          }),
        ),
      release: async (options) => {
        const data = await execute(INTERNAL_COMMANDS.leaseRelease, [], options);
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
      reload: async (options = {}) =>
        await reloadMetro({
          metroHost: options.metroHost,
          metroPort: options.metroPort,
          bundleUrl: options.bundleUrl,
          runtime: config.runtime,
          timeoutMs: options.timeoutMs,
        }),
    },
    capture: {
      snapshot: async (options: CaptureSnapshotOptions = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute(PUBLIC_COMMANDS.snapshot, [], options);
        return normalizeSnapshotResult(data, session);
      },
      screenshot: async (options: CaptureScreenshotOptions = {}) => {
        const session = resolveRequestSession(options);
        const data = await execute(PUBLIC_COMMANDS.screenshot, options.path ? [options.path] : [], {
          ...options,
          ...screenshotFlagsFromOptions(options),
        });
        return {
          path: readRequiredString(data, 'path'),
          overlayRefs: readScreenshotOverlayRefs(data),
          identifiers: { session },
        };
      },
      diff: async (options) =>
        await executeCommandRequest(PUBLIC_COMMANDS.diff, [options.kind], {
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
        await executeCommandRequest(PUBLIC_COMMANDS.click, interactionTargetCodec.encode(options), {
          ...options,
          clickButton: options.button,
        }),
      press: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.press,
          interactionTargetCodec.encode(options),
          options,
        ),
      longPress: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.longPress,
          [String(options.x), String(options.y), ...optionalNumber(options.durationMs)],
          options,
        ),
      swipe: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.swipe,
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
          PUBLIC_COMMANDS.focus,
          [String(options.x), String(options.y)],
          options,
        ),
      type: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.type,
          typeCommandCodec.encode(options),
          options,
        ),
      fill: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.fill,
          fillCommandCodec.encode(options),
          options,
        ),
      scroll: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.scroll,
          [options.direction, ...optionalNumber(options.amount)],
          options,
        ),
      pinch: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.pinch,
          [String(options.scale), ...optionalNumber(options.x), ...optionalNumber(options.y)],
          options,
        ),
      get: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.get,
          [options.format, ...elementTargetCodec.encode(options)],
          options,
        ),
      is: async (options) =>
        await executeCommandRequest(PUBLIC_COMMANDS.is, isCommandCodec.encode(options), options),
      find: async (options) =>
        await executeCommandRequest(PUBLIC_COMMANDS.find, findCommandCodec.encode(options), {
          ...options,
          findFirst: options.first,
          findLast: options.last,
        }),
    },
    replay: {
      run: async (options) =>
        await executeCommandRequest(PUBLIC_COMMANDS.replay, [options.path], {
          ...options,
          replayUpdate: options.update,
          replayBackend: options.backend ?? (options.maestro === true ? 'maestro' : undefined),
          replayEnv: options.env,
          replayShellEnv: collectReplayClientShellEnv(process.env),
        }),
      test: async (options) =>
        await executeCommandRequest(PUBLIC_COMMANDS.test, options.paths, {
          ...options,
          replayUpdate: options.update,
          replayEnv: options.env,
          replayShellEnv: collectReplayClientShellEnv(process.env),
        }),
    },
    batch: {
      run: async (options) =>
        await executeCommandRequest(PUBLIC_COMMANDS.batch, [], {
          ...options,
          batchSteps: options.steps,
          batchOnError: options.onError,
          batchMaxSteps: options.maxSteps,
        }),
    },
    observability: {
      perf: async (options = {}) => await executeCommandRequest(PUBLIC_COMMANDS.perf, [], options),
      logs: async (options = {}) =>
        await executeCommandRequest(PUBLIC_COMMANDS.logs, logsPositionals(options), options),
      network: async (options = {}) =>
        await executeCommandRequest(PUBLIC_COMMANDS.network, networkPositionals(options), {
          ...options,
          networkInclude: options.include,
        }),
    },
    recording: {
      record: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.record,
          [options.action, ...optionalString(options.path)],
          options,
        ),
      trace: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.trace,
          [options.action, ...optionalString(options.path)],
          options,
        ),
    },
    settings: {
      update: async (options) =>
        await executeCommandRequest(
          PUBLIC_COMMANDS.settings,
          settingsCommandCodec.encode(options),
          options,
        ),
    },
  };
}

function normalizeSnapshotResult(
  data: Record<string, unknown>,
  session: string | undefined,
): CaptureSnapshotResult {
  const appBundleId = readOptionalString(data, 'appBundleId');
  return {
    nodes: readSnapshotNodes(data.nodes),
    truncated: data.truncated === true,
    appName: readOptionalString(data, 'appName'),
    appBundleId,
    ...optionalSnapshotResponseFields(data),
    identifiers: {
      session,
      appId: appBundleId,
      appBundleId,
    },
  };
}

function optionalSnapshotResponseFields(
  data: Record<string, unknown>,
): Partial<
  Pick<CaptureSnapshotResult, 'androidSnapshot' | 'unchanged' | 'visibility' | 'warnings'>
> {
  const visibility = readObject(data.visibility);
  const androidSnapshot = readObject(data.androidSnapshot);
  const unchanged = readObject(data.unchanged);
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  return {
    ...(visibility ? { visibility: visibility as CaptureSnapshotResult['visibility'] } : {}),
    ...(androidSnapshot
      ? { androidSnapshot: androidSnapshot as CaptureSnapshotResult['androidSnapshot'] }
      : {}),
    ...(unchanged ? { unchanged: unchanged as CaptureSnapshotResult['unchanged'] } : {}),
    ...(warnings ? { warnings } : {}),
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringifyPayload(payload: AppPushOptions['payload']): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function triggerEventPositionals(options: AppTriggerEventOptions): string[] {
  return [options.event, ...(options.payload ? [JSON.stringify(options.payload)] : [])];
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

export type * from './client-types.ts';
