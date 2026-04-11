import { sendToDaemon } from './daemon-client.ts';
import { prepareMetroRuntime } from './client-metro.ts';
import { AppError } from './utils/errors.ts';
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
  AppCloseOptions,
  AppDeployOptions,
  AppInstallFromSourceOptions,
  AppListOptions,
  AppOpenOptions,
  CaptureScreenshotOptions,
  CaptureSnapshotOptions,
  CaptureSnapshotResult,
  EnsureSimulatorOptions,
  InternalRequestOptions,
  MaterializationReleaseOptions,
  MetroPrepareOptions,
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
    const merged = { ...config, ...options };
    const response = await transport({
      session: resolveSessionName(config.session, options.session),
      command,
      positionals,
      flags: buildFlags(merged),
      runtime: merged.runtime,
      meta: buildMeta(merged),
    });
    if (!response.ok) {
      throw new AppError(response.error.code as any, response.error.message, {
        ...(response.error.details ?? {}),
        hint: response.error.hint,
        diagnosticId: response.error.diagnosticId,
        logPath: response.error.logPath,
      });
    }
    return (response.data ?? {}) as Record<string, unknown>;
  };

  const listSessions = async (options = {}) => {
    const data = await execute('session_list', [], options);
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions.map(normalizeSession);
  };

  return {
    devices: {
      list: async (options = {}) => {
        const data = await execute('devices', [], options);
        const devices = Array.isArray(data.devices) ? data.devices : [];
        return devices.map(normalizeDevice);
      },
    },
    sessions: {
      list: async (options = {}) => await listSessions(options),
      close: async (options = {}) => {
        const session = resolveSessionName(config.session, options.session);
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
          resolveSessionName(config.session, options.session),
        ),
      reinstall: async (options: AppDeployOptions) =>
        normalizeDeployResult(
          await execute('reinstall', [options.app, options.appPath], options),
          resolveSessionName(config.session, options.session),
        ),
      installFromSource: async (options: AppInstallFromSourceOptions) =>
        normalizeInstallFromSourceResult(
          await execute('install_source', [], {
            ...options,
            installSource: options.source,
            retainMaterializedPaths: options.retainPaths,
            materializedPathRetentionMs: options.retentionMs,
          }),
          resolveSessionName(config.session, options.session),
        ),
      list: async (options: AppListOptions = {}) => {
        const data = await execute('apps', [], options);
        return Array.isArray(data.apps)
          ? data.apps.filter((app): app is string => typeof app === 'string')
          : [];
      },
      open: async (options: AppOpenOptions) => {
        const session = resolveSessionName(config.session, options.session);
        const positionals = options.url ? [options.app, options.url] : [options.app];
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
        const session = resolveSessionName(config.session, options.session);
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
    metro: {
      prepare: async (options: MetroPrepareOptions) =>
        await prepareMetroRuntime({
          projectRoot: options.projectRoot ?? config.cwd,
          kind: options.kind,
          publicBaseUrl: options.publicBaseUrl,
          proxyBaseUrl: options.proxyBaseUrl,
          proxyBearerToken: options.bearerToken,
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
        const session = resolveSessionName(config.session, options.session);
        const data = await execute('snapshot', [], options);
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
        const session = resolveSessionName(config.session, options.session);
        const data = await execute('screenshot', options.path ? [options.path] : [], options);
        return {
          path: readRequiredString(data, 'path'),
          overlayRefs: readScreenshotOverlayRefs(data),
          identifiers: { session },
        };
      },
    },
  };
}

export type {
  AgentDeviceClient,
  AgentDeviceClientConfig,
  AgentDeviceDaemonTransport,
  AgentDeviceDevice,
  AgentDeviceIdentifiers,
  AgentDeviceRequestOverrides,
  AgentDeviceSelectionOptions,
  AgentDeviceSession,
  AgentDeviceSessionDevice,
  AppCloseOptions,
  AppCloseResult,
  AppDeployOptions,
  AppDeployResult,
  AppInstallFromSourceOptions,
  AppInstallFromSourceResult,
  AppListOptions,
  AppOpenOptions,
  AppOpenResult,
  CaptureScreenshotOptions,
  CaptureScreenshotResult,
  CaptureSnapshotOptions,
  CaptureSnapshotResult,
  EnsureSimulatorOptions,
  EnsureSimulatorResult,
  MaterializationReleaseOptions,
  MaterializationReleaseResult,
  MetroPrepareOptions,
  MetroPrepareResult,
  SessionCloseResult,
  StartupPerfSample,
} from './client-types.ts';
