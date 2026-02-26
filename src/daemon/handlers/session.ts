import fs from 'node:fs';
import { dispatchCommand, resolveTargetDevice, type BatchStep, type CommandFlags } from '../../core/dispatch.ts';
import {
  DEFAULT_BATCH_MAX_STEPS,
  type BatchStepResult,
  type NormalizedBatchStep,
  validateAndNormalizeBatchSteps,
} from '../../core/batch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { isDeepLinkTarget, resolveIosDeviceDeepLinkBundleId } from '../../core/open-target.ts';
import { AppError, asAppError, normalizeError } from '../../utils/errors.ts';
import { normalizePlatformSelector, type DeviceInfo } from '../../utils/device.ts';
import { resolveAndroidSerialAllowlist, resolveIosSimulatorDeviceSetPath } from '../../utils/device-isolation.ts';
import type { DaemonRequest, DaemonResponse, SessionAction, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { attachRefs, type RawSnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { extractNodeText, normalizeType, pruneGroupNodes } from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  resolveSelectorChain,
  splitIsSelectorArgs,
  splitSelectorFromArgs,
  tryParseSelectorChain,
} from '../selectors.ts';
import { inferFillText, uniqueStrings } from '../action-utils.ts';
import {
  appendScriptSeriesFlags,
  formatScriptActionSummary,
  formatScriptArg,
  isClickLikeCommand,
  parseReplaySeriesFlags,
} from '../script-utils.ts';
import { resolvePayloadInput } from '../../utils/payload-input.ts';
import {
  appendAppLogMarker,
  clearAppLogFiles,
  getAppLogPathMetadata,
  runAppLogDoctor,
  startAppLog,
  stopAppLog,
} from '../app-log.ts';
import { readRecentNetworkTraffic } from '../network-log.ts';

type ReinstallOps = {
  ios: (device: DeviceInfo, app: string, appPath: string) => Promise<{ bundleId: string }>;
  android: (device: DeviceInfo, app: string, appPath: string) => Promise<{ package: string }>;
};

type EnsureAndroidEmulatorBoot = (params: {
  avdName: string;
  serial?: string;
  headless?: boolean;
}) => Promise<DeviceInfo>;

const IOS_APPSTATE_SESSION_REQUIRED_MESSAGE =
  'iOS appstate requires an active session on the target device. Run open first (for example: open --session sim --platform ios --device "<name>" <app>).';
const BATCH_PARENT_FLAG_KEYS: Array<keyof CommandFlags> = ['platform', 'target', 'device', 'udid', 'serial', 'verbose', 'out'];
const REPLAY_PARENT_FLAG_KEYS: Array<keyof CommandFlags> = ['platform', 'target', 'device', 'udid', 'serial', 'verbose', 'out'];
const LOG_ACTIONS = ['path', 'start', 'stop', 'doctor', 'mark', 'clear'] as const;
const LOG_ACTIONS_MESSAGE = `logs requires ${LOG_ACTIONS.slice(0, -1).join(', ')}, or ${LOG_ACTIONS.at(-1)}`;
const PERF_UNAVAILABLE_REASON = 'Not implemented for this platform in this release.';
const STARTUP_SAMPLE_METHOD = 'open-command-roundtrip';
const STARTUP_SAMPLE_DESCRIPTION =
  'Elapsed wall-clock time around dispatching the open command for the active session app target.';
const PERF_STARTUP_SAMPLE_LIMIT = 20;

type StartupPerfSample = {
  durationMs: number;
  measuredAt: string;
  method: typeof STARTUP_SAMPLE_METHOD;
  appTarget?: string;
  appBundleId?: string;
};

function buildOpenResult(params: {
  sessionName: string;
  appName?: string;
  appBundleId?: string;
  startup?: StartupPerfSample;
}): Record<string, unknown> {
  const { sessionName, appName, appBundleId, startup } = params;
  const result: Record<string, unknown> = { session: sessionName };
  if (appName) result.appName = appName;
  if (appBundleId) result.appBundleId = appBundleId;
  if (startup) result.startup = startup;
  return result;
}

function buildStartupPerfSample(
  startedAtMs: number,
  appTarget: string | undefined,
  appBundleId: string | undefined,
): StartupPerfSample {
  return {
    durationMs: Math.max(0, Date.now() - startedAtMs),
    measuredAt: new Date().toISOString(),
    method: STARTUP_SAMPLE_METHOD,
    appTarget,
    appBundleId,
  };
}

function readStartupPerfSamples(actions: SessionAction[]): StartupPerfSample[] {
  const samples: StartupPerfSample[] = [];
  for (const action of actions) {
    if (action.command !== 'open') continue;
    const startup = action.result?.startup;
    if (!startup || typeof startup !== 'object') continue;
    const record = startup as Record<string, unknown>;
    if (
      typeof record.durationMs !== 'number'
      || !Number.isFinite(record.durationMs)
      || typeof record.measuredAt !== 'string'
      || record.measuredAt.trim().length === 0
      || record.method !== STARTUP_SAMPLE_METHOD
    ) {
      continue;
    }
    samples.push({
      durationMs: Math.max(0, Math.round(record.durationMs)),
      measuredAt: record.measuredAt,
      method: STARTUP_SAMPLE_METHOD,
      appTarget: typeof record.appTarget === 'string' && record.appTarget.length > 0 ? record.appTarget : undefined,
      appBundleId: typeof record.appBundleId === 'string' && record.appBundleId.length > 0 ? record.appBundleId : undefined,
    });
  }
  return samples.slice(-PERF_STARTUP_SAMPLE_LIMIT);
}

function buildPerfResponseData(session: SessionState): Record<string, unknown> {
  const startupSamples = readStartupPerfSamples(session.actions);
  const latestStartupSample = startupSamples.at(-1);
  const startupMetric = latestStartupSample
    ? {
      available: true,
      lastDurationMs: latestStartupSample.durationMs,
      lastMeasuredAt: latestStartupSample.measuredAt,
      method: STARTUP_SAMPLE_METHOD,
      sampleCount: startupSamples.length,
      samples: startupSamples,
    }
    : {
      available: false,
      reason: 'No startup sample captured yet. Run open <app|url> in this session first.',
      method: STARTUP_SAMPLE_METHOD,
    };
  return {
    session: session.name,
    platform: session.device.platform,
    device: session.device.name,
    deviceId: session.device.id,
    metrics: {
      startup: startupMetric,
      fps: { available: false, reason: PERF_UNAVAILABLE_REASON },
      memory: { available: false, reason: PERF_UNAVAILABLE_REASON },
      cpu: { available: false, reason: PERF_UNAVAILABLE_REASON },
    },
    sampling: {
      startup: {
        method: STARTUP_SAMPLE_METHOD,
        description: STARTUP_SAMPLE_DESCRIPTION,
        unit: 'ms',
      },
    },
  };
}
const NETWORK_ACTIONS = ['dump', 'log'] as const;
const NETWORK_ACTIONS_MESSAGE = `network requires ${NETWORK_ACTIONS.join(' or ')}`;
const NETWORK_INCLUDE_MODES = ['summary', 'headers', 'body', 'all'] as const;
const NETWORK_INCLUDE_MESSAGE = `network include mode must be one of: ${NETWORK_INCLUDE_MODES.join(', ')}`;
type NetworkIncludeMode = (typeof NETWORK_INCLUDE_MODES)[number];

function requireSessionOrExplicitSelector(
  command: string,
  session: SessionState | undefined,
  flags: DaemonRequest['flags'] | undefined,
): DaemonResponse | null {
  if (session || hasExplicitDeviceSelector(flags)) {
    return null;
  }
  return {
    ok: false,
    error: {
      code: 'INVALID_ARGS',
      message: `${command} requires an active session or an explicit device selector (e.g. --platform ios).`,
    },
  };
}

function hasExplicitDeviceSelector(flags: DaemonRequest['flags'] | undefined): boolean {
  return Boolean(flags?.platform || flags?.target || flags?.device || flags?.udid || flags?.serial);
}

function hasExplicitSessionFlag(flags: DaemonRequest['flags'] | undefined): boolean {
  return typeof flags?.session === 'string' && flags.session.trim().length > 0;
}

function selectorTargetsSessionDevice(
  flags: DaemonRequest['flags'] | undefined,
  session: SessionState | undefined,
): boolean {
  if (!session) return false;
  if (!hasExplicitDeviceSelector(flags)) return true;
  const normalizedPlatform = normalizePlatformSelector(flags?.platform);
  if (normalizedPlatform && normalizedPlatform !== session.device.platform) return false;
  if (flags?.target && flags.target !== (session.device.target ?? 'mobile')) return false;
  if (flags?.udid && flags.udid !== session.device.id) return false;
  if (flags?.serial && flags.serial !== session.device.id) return false;
  if (flags?.device) {
    return flags.device.trim().toLowerCase() === session.device.name.trim().toLowerCase();
  }
  return true;
}

async function resolveCommandDevice(params: {
  session: SessionState | undefined;
  flags: DaemonRequest['flags'] | undefined;
  ensureReadyFn: typeof ensureDeviceReady;
  resolveTargetDeviceFn: typeof resolveTargetDevice;
  ensureReady?: boolean;
}): Promise<DeviceInfo> {
  const shouldUseExplicitSelector = hasExplicitDeviceSelector(params.flags);
  const device =
    shouldUseExplicitSelector || !params.session
      ? await params.resolveTargetDeviceFn(params.flags ?? {})
      : params.session.device;
  if (params.ensureReady !== false) {
    await params.ensureReadyFn(device);
  }
  return device;
}

function resolveAndroidEmulatorAvdName(params: {
  flags: DaemonRequest['flags'] | undefined;
  sessionDevice?: DeviceInfo;
  resolvedDevice?: DeviceInfo;
}): string | undefined {
  const explicit = params.flags?.device?.trim();
  if (explicit) return explicit;
  if (params.resolvedDevice?.platform === 'android' && params.resolvedDevice.kind === 'emulator') {
    return params.resolvedDevice.name;
  }
  if (params.sessionDevice?.platform === 'android' && params.sessionDevice.kind === 'emulator') {
    return params.sessionDevice.name;
  }
  return undefined;
}

const defaultEnsureAndroidEmulatorBoot: EnsureAndroidEmulatorBoot = async ({ avdName, serial, headless }) => {
  const { ensureAndroidEmulatorBooted } = await import('../../platforms/android/devices.ts');
  return await ensureAndroidEmulatorBooted({ avdName, serial, headless });
};

const defaultReinstallOps: ReinstallOps = {
  ios: async (device, app, appPath) => {
    const { reinstallIosApp } = await import('../../platforms/ios/index.ts');
    return await reinstallIosApp(device, app, appPath);
  },
  android: async (device, app, appPath) => {
    const { reinstallAndroidApp } = await import('../../platforms/android/index.ts');
    return await reinstallAndroidApp(device, app, appPath);
  },
};

async function resolveIosBundleIdForOpen(
  device: DeviceInfo,
  openTarget: string | undefined,
  currentAppBundleId?: string,
): Promise<string | undefined> {
  if (device.platform !== 'ios' || !openTarget) return undefined;
  if (isDeepLinkTarget(openTarget)) {
    if (device.kind === 'device') {
      return resolveIosDeviceDeepLinkBundleId(currentAppBundleId, openTarget);
    }
    return undefined;
  }
  return await tryResolveIosAppBundleId(device, openTarget);
}

async function tryResolveIosAppBundleId(device: DeviceInfo, openTarget: string): Promise<string | undefined> {
  try {
    const { resolveIosApp } = await import('../../platforms/ios/index.ts');
    return await resolveIosApp(device, openTarget);
  } catch {
    return undefined;
  }
}

async function resolveAndroidPackageForOpen(
  device: DeviceInfo,
  openTarget: string | undefined,
): Promise<string | undefined> {
  if (device.platform !== 'android' || !openTarget || isDeepLinkTarget(openTarget)) return undefined;
  try {
    const { resolveAndroidApp } = await import('../../platforms/android/index.ts');
    const resolved = await resolveAndroidApp(device, openTarget);
    return resolved.type === 'package' ? resolved.value : undefined;
  } catch {
    return undefined;
  }
}

function shouldPreserveAndroidPackageContext(
  device: DeviceInfo,
  openTarget: string | undefined,
): boolean {
  return device.platform === 'android' && Boolean(openTarget && isDeepLinkTarget(openTarget));
}

async function handleAppStateCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
}): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, ensureReady, resolveDevice } = params;
  const session = sessionStore.get(sessionName);
  const flags = req.flags ?? {};
  const normalizedPlatform = normalizePlatformSelector(flags.platform);
  if (!session && hasExplicitSessionFlag(flags)) {
    const iOSSessionHint =
      normalizedPlatform === 'ios'
        ? `No active session "${sessionName}". Run open with --session ${sessionName} first.`
        : `No active session "${sessionName}". Run open with --session ${sessionName} first, or omit --session to query by device selector.`;
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: iOSSessionHint,
      },
    };
  }
  const guard = requireSessionOrExplicitSelector('appstate', session, flags);
  if (guard) return guard;

  const shouldUseSessionStateForIos = session?.device.platform === 'ios' && selectorTargetsSessionDevice(flags, session);
  const targetsIos = normalizedPlatform === 'ios';
  if (targetsIos && !shouldUseSessionStateForIos) {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: IOS_APPSTATE_SESSION_REQUIRED_MESSAGE,
      },
    };
  }
  if (shouldUseSessionStateForIos) {
    const appName = session.appName ?? session.appBundleId;
    if (!session.appName && !session.appBundleId) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: 'No foreground app is tracked for this iOS session. Open an app in the session, then retry appstate.',
        },
      };
    }
    return {
      ok: true,
      data: {
        platform: 'ios',
        appName: appName ?? 'unknown',
        appBundleId: session.appBundleId,
        source: 'session',
      },
    };
  }
  const device = await resolveCommandDevice({
    session,
    flags,
    ensureReadyFn: ensureReady,
    resolveTargetDeviceFn: resolveDevice,
    ensureReady: true,
  });
  if (device.platform === 'ios') {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: IOS_APPSTATE_SESSION_REQUIRED_MESSAGE,
      },
    };
  }
  const { getAndroidAppState } = await import('../../platforms/android/index.ts');
  const state = await getAndroidAppState(device);
  return {
    ok: true,
    data: {
      platform: 'android',
      package: state.package,
      activity: state.activity,
    },
  };
}

async function handleClipboardCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  dispatch: typeof dispatchCommand;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore, ensureReady, resolveDevice, dispatch } = params;
  const session = sessionStore.get(sessionName);
  const flags = req.flags ?? {};
  const guard = requireSessionOrExplicitSelector('clipboard', session, flags);
  if (guard) return guard;

  const action = (req.positionals?.[0] ?? '').toLowerCase();
  if (action !== 'read' && action !== 'write') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'clipboard requires a subcommand: read or write',
      },
    };
  }

  const device = await resolveCommandDevice({
    session,
    flags,
    ensureReadyFn: ensureReady,
    resolveTargetDeviceFn: resolveDevice,
    ensureReady: true,
  });

  if (!isCommandSupportedOnDevice('clipboard', device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'clipboard is not supported on this device',
      },
    };
  }

  const result = await dispatch(device, 'clipboard', req.positionals ?? [], req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  });
  if (session) {
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: result ?? {},
    });
  }
  return { ok: true, data: { platform: device.platform, ...(result ?? {}) } };
}

export async function handleSessionCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  dispatch?: typeof dispatchCommand;
  ensureReady?: typeof ensureDeviceReady;
  resolveTargetDevice?: typeof resolveTargetDevice;
  reinstallOps?: ReinstallOps;
  stopIosRunner?: typeof stopIosRunnerSession;
  appLogOps?: {
    start: typeof startAppLog;
    stop: typeof stopAppLog;
  };
  ensureAndroidEmulatorBoot?: EnsureAndroidEmulatorBoot;
  resolveAndroidPackageForOpen?: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>;
}): Promise<DaemonResponse | null> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
    dispatch: dispatchOverride,
    ensureReady: ensureReadyOverride,
    resolveTargetDevice: resolveTargetDeviceOverride,
    reinstallOps = defaultReinstallOps,
    stopIosRunner: stopIosRunnerOverride,
    appLogOps = {
      start: startAppLog,
      stop: stopAppLog,
    },
    ensureAndroidEmulatorBoot: ensureAndroidEmulatorBootOverride = defaultEnsureAndroidEmulatorBoot,
    resolveAndroidPackageForOpen: resolveAndroidPackageForOpenOverride = resolveAndroidPackageForOpen,
  } = params;
  const dispatch = dispatchOverride ?? dispatchCommand;
  const ensureReady = ensureReadyOverride ?? ensureDeviceReady;
  const resolveDevice = resolveTargetDeviceOverride ?? resolveTargetDevice;
  const stopIosRunner = stopIosRunnerOverride ?? stopIosRunnerSession;
  const command = req.command;

  if (command === 'session_list') {
    const data = {
      sessions: sessionStore.toArray().map((s) => ({
        name: s.name,
        platform: s.device.platform,
        target: s.device.target ?? 'mobile',
        device: s.device.name,
        id: s.device.id,
        createdAt: s.createdAt,
      })),
    };
    return { ok: true, data };
  }

  if (command === 'devices') {
    try {
      const devices: DeviceInfo[] = [];
      const iosSimulatorSetPath = resolveIosSimulatorDeviceSetPath(req.flags?.iosSimulatorDeviceSet);
      const androidSerialAllowlist = resolveAndroidSerialAllowlist(req.flags?.androidDeviceAllowlist);
      const requestedPlatform = normalizePlatformSelector(req.flags?.platform);
      if (requestedPlatform === 'android') {
        const { listAndroidDevices } = await import('../../platforms/android/devices.ts');
        devices.push(...(await listAndroidDevices({ serialAllowlist: androidSerialAllowlist })));
      } else if (requestedPlatform === 'ios') {
        const { listIosDevices } = await import('../../platforms/ios/devices.ts');
        devices.push(...(await listIosDevices({ simulatorSetPath: iosSimulatorSetPath })));
      } else {
        const { listAndroidDevices } = await import('../../platforms/android/devices.ts');
        const { listIosDevices } = await import('../../platforms/ios/devices.ts');
        try {
          devices.push(...(await listAndroidDevices({ serialAllowlist: androidSerialAllowlist })));
        } catch {
          // ignore
        }
        try {
          devices.push(...(await listIosDevices({ simulatorSetPath: iosSimulatorSetPath })));
        } catch {
          // ignore
        }
      }
      const filtered = req.flags?.target
        ? devices.filter((device) => (device.target ?? 'mobile') === req.flags?.target)
        : devices;
      const publicDevices = filtered.map(({ simulatorSetPath: _simulatorSetPath, ...device }) => device);
      return { ok: true, data: { devices: publicDevices } };
    } catch (err) {
      const appErr = asAppError(err);
      return { ok: false, error: { code: appErr.code, message: appErr.message, details: appErr.details } };
    }
  }

  if (command === 'apps') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const guard = requireSessionOrExplicitSelector(command, session, flags);
    if (guard) return guard;
    const device = await resolveCommandDevice({
      session,
      flags,
      ensureReadyFn: ensureReady,
      resolveTargetDeviceFn: resolveDevice,
      ensureReady: true,
    });
    if (!isCommandSupportedOnDevice('apps', device)) {
      return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'apps is not supported on this device' } };
    }
    const appsFilter = req.flags?.appsFilter ?? 'all';
    if (device.platform === 'ios') {
      const { listIosApps } = await import('../../platforms/ios/index.ts');
      const apps = await listIosApps(device, appsFilter);
      const formatted = apps.map((app) =>
        app.name && app.name !== app.bundleId ? `${app.name} (${app.bundleId})` : app.bundleId,
      );
      return { ok: true, data: { apps: formatted } };
    }
    const { listAndroidApps } = await import('../../platforms/android/index.ts');
    const apps = await listAndroidApps(device, appsFilter);
    const formatted = apps.map((app) =>
      app.name && app.name !== app.package ? `${app.name} (${app.package})` : app.package,
    );
    return { ok: true, data: { apps: formatted } };
  }

  if (command === 'boot') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const guard = requireSessionOrExplicitSelector(command, session, flags);
    if (guard) return guard;
    const normalizedPlatform = normalizePlatformSelector(flags.platform) ?? session?.device.platform;
    const targetsAndroid = normalizedPlatform === 'android';
    const wantsAndroidHeadless = flags.headless === true;
    if (wantsAndroidHeadless && !targetsAndroid) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'boot --headless is supported only for Android emulators.',
        },
      };
    }
    const fallbackAvdName = resolveAndroidEmulatorAvdName({
      flags,
      sessionDevice: session?.device,
    });
    const canFallbackLaunchAndroidEmulator = targetsAndroid && Boolean(fallbackAvdName);
    let device: DeviceInfo;
    let launchedAndroidEmulator = false;
    try {
      device = await resolveCommandDevice({
        session,
        flags,
        ensureReadyFn: ensureReady,
        resolveTargetDeviceFn: resolveDevice,
        ensureReady: false,
      });
    } catch (error) {
      const appErr = asAppError(error);
      if (targetsAndroid && wantsAndroidHeadless && !fallbackAvdName && appErr.code === 'DEVICE_NOT_FOUND') {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'boot --headless requires --device <avd-name> (or an Android emulator session target).',
          },
        };
      }
      if (!canFallbackLaunchAndroidEmulator || appErr.code !== 'DEVICE_NOT_FOUND' || !fallbackAvdName) {
        throw error;
      }
      device = await ensureAndroidEmulatorBootOverride({
        avdName: fallbackAvdName,
        serial: flags.serial,
        headless: wantsAndroidHeadless,
      });
      launchedAndroidEmulator = true;
    }
    if (flags.target && (device.target ?? 'mobile') !== flags.target) {
      return {
        ok: false,
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: `No ${device.platform} device found matching --target ${flags.target}.`,
        },
      };
    }
    if (targetsAndroid && wantsAndroidHeadless) {
      if (device.platform !== 'android' || device.kind !== 'emulator') {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'boot --headless is supported only for Android emulators.',
          },
        };
      }
      if (!launchedAndroidEmulator) {
        const avdName = resolveAndroidEmulatorAvdName({
          flags,
          sessionDevice: session?.device,
          resolvedDevice: device,
        });
        if (!avdName) {
          return {
            ok: false,
            error: {
              code: 'INVALID_ARGS',
              message: 'boot --headless requires --device <avd-name> (or an Android emulator session target).',
            },
          };
        }
        device = await ensureAndroidEmulatorBootOverride({
          avdName,
          serial: flags.serial,
          headless: true,
        });
      }
      await ensureReady(device);
    } else {
      const shouldEnsureReady = device.platform !== 'android' || device.booted !== true;
      if (shouldEnsureReady) {
        await ensureReady(device);
      }
    }
    if (!isCommandSupportedOnDevice('boot', device)) {
      return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'boot is not supported on this device' } };
    }
    return {
      ok: true,
      data: {
        platform: device.platform,
        target: device.target ?? 'mobile',
        device: device.name,
        id: device.id,
        kind: device.kind,
        booted: true,
      },
    };
  }

  if (command === 'appstate') {
    return await handleAppStateCommand({
      req,
      sessionName,
      sessionStore,
      ensureReady,
      resolveDevice,
    });
  }

  if (command === 'clipboard') {
    return await handleClipboardCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
      ensureReady,
      resolveDevice,
      dispatch,
    });
  }

  if (command === 'perf') {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'perf requires an active session. Run open first.',
        },
      };
    }
    return {
      ok: true,
      data: buildPerfResponseData(session),
    };
  }

  if (command === 'reinstall') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const guard = requireSessionOrExplicitSelector(command, session, flags);
    if (guard) return guard;
    const app = req.positionals?.[0]?.trim();
    const appPathInput = req.positionals?.[1]?.trim();
    if (!app || !appPathInput) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'reinstall requires: reinstall <app> <path-to-app-binary>' },
      };
    }
    const appPath = SessionStore.expandHome(appPathInput);
    if (!fs.existsSync(appPath)) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `App binary not found: ${appPath}` },
      };
    }
    const device = await resolveCommandDevice({
      session,
      flags,
      ensureReadyFn: ensureReady,
      resolveTargetDeviceFn: resolveDevice,
      ensureReady: false,
    });
    if (!isCommandSupportedOnDevice('reinstall', device)) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'reinstall is not supported on this device' },
      };
    }
    let reinstallData:
      | { platform: 'ios'; appId: string; bundleId: string }
      | { platform: 'android'; appId: string; package: string };
    if (device.platform === 'ios') {
      const iosResult = await reinstallOps.ios(device, app, appPath);
      reinstallData = { platform: 'ios', appId: iosResult.bundleId, bundleId: iosResult.bundleId };
    } else {
      const androidResult = await reinstallOps.android(device, app, appPath);
      reinstallData = { platform: 'android', appId: androidResult.package, package: androidResult.package };
    }
    const result = { app, appPath, ...reinstallData };
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result,
      });
    }
    return { ok: true, data: result };
  }

  if (command === 'push') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const guard = requireSessionOrExplicitSelector(command, session, flags);
    if (guard) return guard;
    const appId = req.positionals?.[0]?.trim();
    const payloadArg = req.positionals?.[1]?.trim();
    if (!appId || !payloadArg) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'push requires <bundle|package> <payload.json|inline-json>',
        },
      };
    }
    const normalizedPayloadArg = maybeResolvePushPayloadPath(payloadArg, req.meta?.cwd);
    const device = await resolveCommandDevice({
      session,
      flags,
      ensureReadyFn: ensureReady,
      resolveTargetDeviceFn: resolveDevice,
      ensureReady: true,
    });
    if (!isCommandSupportedOnDevice('push', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'push is not supported on this device',
        },
      };
    }
    const result = await dispatch(device, 'push', [appId, normalizedPayloadArg], req.flags?.out, {
      ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
    });
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: [appId, payloadArg],
        flags: req.flags ?? {},
        result: result ?? {},
      });
    }
    return { ok: true, data: result ?? {} };
  }

  if (command === 'open') {
    const shouldRelaunch = req.flags?.relaunch === true;
    if (sessionStore.has(sessionName)) {
      const session = sessionStore.get(sessionName);
      const requestedOpenTarget = req.positionals?.[0];
      const openTarget = requestedOpenTarget ?? (shouldRelaunch ? session?.appName : undefined);
      if (!session || !openTarget) {
        if (shouldRelaunch) {
          return {
            ok: false,
            error: {
              code: 'INVALID_ARGS',
              message: 'open --relaunch requires an app name or an active session app.',
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'Session already active. Close it first or pass a new --session name.',
          },
        };
      }
      if (shouldRelaunch && isDeepLinkTarget(openTarget)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'open --relaunch does not support URL targets.',
          },
        };
      }
      await ensureReady(session.device);
      const appBundleId =
        (await resolveIosBundleIdForOpen(session.device, openTarget, session.appBundleId))
        ?? (await resolveAndroidPackageForOpenOverride(session.device, openTarget))
        ?? (shouldPreserveAndroidPackageContext(session.device, openTarget) ? session.appBundleId : undefined);
      const openPositionals = requestedOpenTarget ? (req.positionals ?? []) : [openTarget];
      if (shouldRelaunch) {
        const closeTarget = appBundleId ?? openTarget;
        await dispatch(session.device, 'close', [closeTarget], req.flags?.out, {
          ...contextFromFlags(logPath, req.flags, appBundleId ?? session.appBundleId, session.trace?.outPath),
        });
      }
      const openStartedAtMs = Date.now();
      await dispatch(session.device, 'open', openPositionals, req.flags?.out, {
        ...contextFromFlags(logPath, req.flags, appBundleId),
      });
      const startupSample = buildStartupPerfSample(openStartedAtMs, openTarget, appBundleId);
      const nextSession: SessionState = {
        ...session,
        appBundleId,
        appName: openTarget,
        recordSession: session.recordSession || Boolean(req.flags?.saveScript),
        snapshot: undefined,
      };
      const openResult = buildOpenResult({
        sessionName,
        appName: openTarget,
        appBundleId,
        startup: startupSample,
      });
      sessionStore.recordAction(nextSession, {
        command,
        positionals: openPositionals,
        flags: req.flags ?? {},
        result: openResult,
      });
      sessionStore.set(sessionName, nextSession);
      return { ok: true, data: openResult };
    }
    const openTarget = req.positionals?.[0];
    if (shouldRelaunch && !openTarget) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'open --relaunch requires an app argument.',
        },
      };
    }
    if (shouldRelaunch && openTarget && isDeepLinkTarget(openTarget)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'open --relaunch does not support URL targets.',
        },
      };
    }
    const device = await resolveDevice(req.flags ?? {});
    const inUse = sessionStore.toArray().find((s) => s.device.id === device.id);
    if (inUse) {
      return {
        ok: false,
        error: {
          code: 'DEVICE_IN_USE',
          message: `Device is already in use by session "${inUse.name}".`,
          details: { session: inUse.name, deviceId: device.id, deviceName: device.name },
        },
      };
    }
    await ensureReady(device);
    const appBundleId =
      (await resolveIosBundleIdForOpen(device, openTarget))
      ?? (await resolveAndroidPackageForOpenOverride(device, openTarget));
    if (shouldRelaunch && openTarget) {
      const closeTarget = appBundleId ?? openTarget;
      await dispatch(device, 'close', [closeTarget], req.flags?.out, {
        ...contextFromFlags(logPath, req.flags, appBundleId),
      });
    }
    const openStartedAtMs = Date.now();
    await dispatch(device, 'open', req.positionals ?? [], req.flags?.out, {
      ...contextFromFlags(logPath, req.flags, appBundleId),
    });
    const startupSample = openTarget ? buildStartupPerfSample(openStartedAtMs, openTarget, appBundleId) : undefined;
    const session: SessionState = {
      name: sessionName,
      device,
      createdAt: Date.now(),
      appBundleId,
      appName: openTarget,
      recordSession: Boolean(req.flags?.saveScript),
      actions: [],
    };
    const openResult = buildOpenResult({
      sessionName,
      appName: openTarget,
      appBundleId,
      startup: startupSample,
    });
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: openResult,
    });
    sessionStore.set(sessionName, session);
    return { ok: true, data: openResult };
  }

  if (command === 'replay') {
    const filePath = req.positionals?.[0];
    if (!filePath) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'replay requires a path' } };
    }
    try {
      const resolved = SessionStore.expandHome(filePath, req.meta?.cwd);
      const script = fs.readFileSync(resolved, 'utf8');
      const firstNonWhitespace = script.trimStart()[0];
      if (firstNonWhitespace === '{' || firstNonWhitespace === '[') {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'replay accepts .ad script files. JSON replay payloads are no longer supported.',
          },
        };
      }
      const actions = parseReplayScript(script);
      const shouldUpdate = req.flags?.replayUpdate === true;
      let healed = 0;
      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        if (!action || action.command === 'replay') continue;
        let response = await invoke({
          token: req.token,
          session: sessionName,
          command: action.command,
          positionals: action.positionals ?? [],
          flags: buildReplayActionFlags(req.flags, action.flags),
          meta: req.meta,
        });
        if (response.ok) continue;
        if (!shouldUpdate) {
          return withReplayFailureContext(response, action, index, resolved);
        }
        const nextAction = await healReplayAction({
          action,
          sessionName,
          logPath,
          sessionStore,
          dispatch,
        });
        if (!nextAction) {
          return withReplayFailureContext(response, action, index, resolved);
        }
        actions[index] = nextAction;
        response = await invoke({
          token: req.token,
          session: sessionName,
          command: nextAction.command,
          positionals: nextAction.positionals ?? [],
          flags: buildReplayActionFlags(req.flags, nextAction.flags),
          meta: req.meta,
        });
        if (!response.ok) {
          return withReplayFailureContext(response, nextAction, index, resolved);
        }
        healed += 1;
      }
      if (shouldUpdate && healed > 0) {
        const session = sessionStore.get(sessionName);
        writeReplayScript(resolved, actions, session);
      }
      return { ok: true, data: { replayed: actions.length, healed, session: sessionName } };
    } catch (err) {
      const appErr = asAppError(err);
      return { ok: false, error: { code: appErr.code, message: appErr.message } };
    }
  }

  if (command === 'logs') {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'logs requires an active session' } };
    }
    const action = (req.positionals?.[0] ?? 'path').toLowerCase();
    const restart = Boolean(req.flags?.restart);
    if (!LOG_ACTIONS.includes(action as (typeof LOG_ACTIONS)[number])) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: LOG_ACTIONS_MESSAGE } };
    }
    if (restart && action !== 'clear') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'logs --restart is only supported with logs clear' } };
    }
    if (action === 'path') {
      const logPath = sessionStore.resolveAppLogPath(sessionName);
      const metadata = getAppLogPathMetadata(logPath);
      const backend =
        session.appLog?.backend
        ?? (session.device.platform === 'ios'
          ? session.device.kind === 'device'
            ? 'ios-device'
            : 'ios-simulator'
          : 'android');
      return {
        ok: true,
        data: {
          path: logPath,
          active: Boolean(session.appLog),
          state: session.appLog?.getState() ?? 'inactive',
          backend,
          sizeBytes: metadata.sizeBytes,
          modifiedAt: metadata.modifiedAt,
          startedAt: session.appLog?.startedAt ? new Date(session.appLog.startedAt).toISOString() : undefined,
          hint: 'Grep the file for token-efficient debugging, e.g. grep -n "Error\\|Exception" <path>',
        },
      };
    }
    if (action === 'doctor') {
      const logPath = sessionStore.resolveAppLogPath(sessionName);
      const doctor = await runAppLogDoctor(session.device, session.appBundleId);
      return {
        ok: true,
        data: {
          path: logPath,
          active: Boolean(session.appLog),
          state: session.appLog?.getState() ?? 'inactive',
          checks: doctor.checks,
          notes: doctor.notes,
        },
      };
    }
    if (action === 'mark') {
      const marker = req.positionals?.slice(1).join(' ') ?? '';
      const logPath = sessionStore.resolveAppLogPath(sessionName);
      appendAppLogMarker(logPath, marker);
      return { ok: true, data: { path: logPath, marked: true } };
    }
    if (action === 'clear') {
      if (session.appLog && !restart) {
        return {
          ok: false,
          error: { code: 'INVALID_ARGS', message: 'logs clear requires logs to be stopped first; run logs stop' },
        };
      }
      if (restart) {
        if (!session.appBundleId) {
          return { ok: false, error: { code: 'INVALID_ARGS', message: 'logs clear --restart requires an app session; run open <app> first' } };
        }
        if (!isCommandSupportedOnDevice('logs', session.device)) {
          const unsupportedError = normalizeError(new AppError('UNSUPPORTED_OPERATION', 'logs is not supported on this device'));
          return {
            ok: false,
            error: unsupportedError,
          };
        }
      }
      const logPath = sessionStore.resolveAppLogPath(sessionName);
      if (restart) {
        if (session.appLog) {
          await appLogOps.stop(session.appLog);
        }
        const cleared = clearAppLogFiles(logPath);
        const appLogPidPath = sessionStore.resolveAppLogPidPath(sessionName);
        try {
          const appLogStream = await appLogOps.start(session.device, session.appBundleId as string, logPath, appLogPidPath);
          const nextSession: SessionState = {
            ...session,
            appLog: {
              platform: session.device.platform,
              backend: appLogStream.backend,
              outPath: logPath,
              startedAt: appLogStream.startedAt,
              getState: appLogStream.getState,
              stop: appLogStream.stop,
              wait: appLogStream.wait,
            },
          };
          sessionStore.set(sessionName, nextSession);
          return { ok: true, data: { ...cleared, restarted: true } };
        } catch (err) {
          const normalizedError = normalizeError(err);
          sessionStore.set(sessionName, { ...session, appLog: undefined });
          return { ok: false, error: normalizedError };
        }
      }
      const cleared = clearAppLogFiles(logPath);
      return { ok: true, data: cleared };
    }
    if (action === 'start') {
      if (session.appLog) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'app log already streaming; run logs stop first' } };
      }
      if (!session.appBundleId) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'logs start requires an app session; run open <app> first' } };
      }
      if (!isCommandSupportedOnDevice('logs', session.device)) {
        const unsupportedError = normalizeError(new AppError('UNSUPPORTED_OPERATION', 'logs is not supported on this device'));
        return {
          ok: false,
          error: unsupportedError,
        };
      }
      const appLogPath = sessionStore.resolveAppLogPath(sessionName);
      const appLogPidPath = sessionStore.resolveAppLogPidPath(sessionName);
      try {
        const appLogStream = await appLogOps.start(session.device, session.appBundleId, appLogPath, appLogPidPath);
        const nextSession: SessionState = {
          ...session,
          appLog: {
            platform: session.device.platform,
            backend: appLogStream.backend,
            outPath: appLogPath,
            startedAt: appLogStream.startedAt,
            getState: appLogStream.getState,
            stop: appLogStream.stop,
            wait: appLogStream.wait,
          },
        };
        sessionStore.set(sessionName, nextSession);
        return { ok: true, data: { path: appLogPath, started: true } };
      } catch (err) {
        const normalizedError = normalizeError(err);
        return { ok: false, error: normalizedError };
      }
    }
    if (action === 'stop') {
      if (!session.appLog) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'no app log stream active' } };
      }
      const outPath = session.appLog.outPath;
      await appLogOps.stop(session.appLog);
      sessionStore.set(sessionName, { ...session, appLog: undefined });
      return { ok: true, data: { path: outPath, stopped: true } };
    }
  }

  if (command === 'network') {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'network requires an active session' } };
    }
    const action = (req.positionals?.[0] ?? 'dump').toLowerCase();
    if (!NETWORK_ACTIONS.includes(action as (typeof NETWORK_ACTIONS)[number])) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: NETWORK_ACTIONS_MESSAGE } };
    }

    const requestedLimit = req.positionals?.[1];
    const maxEntries = requestedLimit ? Number.parseInt(requestedLimit, 10) : 25;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 200) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'network dump limit must be an integer in range 1..200' } };
    }

    const requestedInclude = (req.positionals?.[2] ?? 'summary').toLowerCase();
    if (!NETWORK_INCLUDE_MODES.includes(requestedInclude as (typeof NETWORK_INCLUDE_MODES)[number])) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: NETWORK_INCLUDE_MESSAGE } };
    }
    const include = requestedInclude as NetworkIncludeMode;

    const networkPath = sessionStore.resolveAppLogPath(sessionName);
    const dump = readRecentNetworkTraffic(networkPath, {
      maxEntries,
      include,
      maxPayloadChars: 2048,
      maxScanLines: 4000,
    });
    const backend =
      session.appLog?.backend
      ?? (session.device.platform === 'ios'
        ? session.device.kind === 'device'
          ? 'ios-device'
          : 'ios-simulator'
        : 'android');
    const notes: string[] = [];
    if (!session.appLog) {
      notes.push('Capture uses the session app log file. For fresh traffic, run logs clear --restart before reproducing requests.');
    }
    if (dump.entries.length === 0) {
      notes.push('No HTTP(s) entries were found in recent session app logs.');
    }
    return {
      ok: true,
      data: {
        ...dump,
        active: Boolean(session.appLog),
        state: session.appLog?.getState() ?? 'inactive',
        backend,
        notes,
      },
    };
  }

  if (command === 'batch') {
    return await runBatchCommands(req, sessionName, invoke);
  }

  if (command === 'close') {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (session.appLog) {
      await appLogOps.stop(session.appLog);
    }
    if (req.positionals && req.positionals.length > 0) {
      await dispatch(session.device, 'close', req.positionals ?? [], req.flags?.out, {
        ...contextFromFlags(logPath, req.flags, session.appBundleId, session.trace?.outPath),
      });
    }
    if (session.device.platform === 'ios') {
      await stopIosRunner(session.device.id);
    }
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { session: sessionName },
    });
    if (req.flags?.saveScript) {
      session.recordSession = true;
    }
    sessionStore.writeSessionLog(session);
    sessionStore.delete(sessionName);
    return { ok: true, data: { session: sessionName } };
  }

  return null;
}

function maybeResolvePushPayloadPath(payloadArg: string, cwd?: string): string {
  const resolved = resolvePayloadInput(payloadArg, {
    subject: 'Push payload',
    cwd,
    expandPath: (value, currentCwd) => SessionStore.expandHome(value, currentCwd),
  });
  return resolved.kind === 'file' ? resolved.path : resolved.text;
}

async function runBatchCommands(
  req: DaemonRequest,
  sessionName: string,
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>,
): Promise<DaemonResponse> {
  const batchOnError = req.flags?.batchOnError ?? 'stop';
  if (batchOnError !== 'stop') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `Unsupported batch on-error mode: ${batchOnError}.`,
      },
    };
  }
  const batchMaxSteps = req.flags?.batchMaxSteps ?? DEFAULT_BATCH_MAX_STEPS;
  if (!Number.isInteger(batchMaxSteps) || batchMaxSteps < 1 || batchMaxSteps > 1000) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `Invalid batch max-steps: ${String(req.flags?.batchMaxSteps)}`,
      },
    };
  }
  try {
    const steps = validateAndNormalizeBatchSteps(req.flags?.batchSteps, batchMaxSteps);
    const startedAt = Date.now();
    const partialResults: BatchStepResult[] = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const stepResponse = await runBatchStep(req, sessionName, step, invoke, index + 1);
      if (!stepResponse.ok) {
        return {
          ok: false,
          error: {
            code: stepResponse.error.code,
            message: `Batch failed at step ${stepResponse.step} (${step.command}): ${stepResponse.error.message}`,
            hint: stepResponse.error.hint,
            diagnosticId: stepResponse.error.diagnosticId,
            logPath: stepResponse.error.logPath,
            details: {
              ...(stepResponse.error.details ?? {}),
              step: stepResponse.step,
              command: step.command,
              positionals: step.positionals,
              executed: index,
              total: steps.length,
              partialResults,
            },
          },
        };
      }
      partialResults.push(stepResponse.result);
    }
    return {
      ok: true,
      data: {
        total: steps.length,
        executed: steps.length,
        totalDurationMs: Date.now() - startedAt,
        results: partialResults,
      },
    };
  } catch (error) {
    const appErr = asAppError(error);
    return {
      ok: false,
      error: { code: appErr.code, message: appErr.message, details: appErr.details },
    };
  }
}

async function runBatchStep(
  req: DaemonRequest,
  sessionName: string,
  step: NormalizedBatchStep,
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>,
  stepNumber: number,
): Promise<
  | { ok: true; step: number; result: BatchStepResult }
  | {
    ok: false;
    step: number;
    error: {
      code: string;
      message: string;
      hint?: string;
      diagnosticId?: string;
      logPath?: string;
      details?: Record<string, unknown>;
    };
  }
> {
  const stepStartedAt = Date.now();
  const response = await invoke({
    token: req.token,
    session: sessionName,
    command: step.command,
    positionals: step.positionals,
    flags: buildBatchStepFlags(req.flags, step.flags),
    meta: req.meta,
  });
  const durationMs = Date.now() - stepStartedAt;
  if (!response.ok) {
    return { ok: false, step: stepNumber, error: response.error };
  }
  return {
    ok: true,
    step: stepNumber,
    result: {
      step: stepNumber,
      command: step.command,
      ok: true,
      data: response.data ?? {},
      durationMs,
    },
  };
}

function buildBatchStepFlags(
  parentFlags: CommandFlags | undefined,
  stepFlags: BatchStep['flags'] | undefined,
): CommandFlags {
  const merged: CommandFlags = { ...(stepFlags ?? {}) };
  const mergedRecord = merged as Record<string, unknown>;
  delete mergedRecord.batchSteps;
  delete mergedRecord.batchOnError;
  delete mergedRecord.batchMaxSteps;
  const parentRecord = (parentFlags ?? {}) as Record<string, unknown>;
  for (const key of BATCH_PARENT_FLAG_KEYS) {
    if (mergedRecord[key] === undefined && parentRecord[key] !== undefined) {
      mergedRecord[key] = parentRecord[key];
    }
  }
  return merged;
}

function withReplayFailureContext(
  response: DaemonResponse,
  action: SessionAction,
  index: number,
  replayPath: string,
): DaemonResponse {
  if (response.ok) return response;
  const step = index + 1;
  const summary = formatReplayActionSummary(action);
  const details = {
    ...(response.error.details ?? {}),
    replayPath,
    step,
    action: action.command,
    positionals: action.positionals ?? [],
  };
    return {
      ok: false,
      error: {
        code: response.error.code,
        message: `Replay failed at step ${step} (${summary}): ${response.error.message}`,
        hint: response.error.hint,
        diagnosticId: response.error.diagnosticId,
        logPath: response.error.logPath,
        details,
      },
    };
}

function buildReplayActionFlags(
  parentFlags: CommandFlags | undefined,
  actionFlags: SessionAction['flags'] | undefined,
): CommandFlags {
  const merged: CommandFlags = { ...(actionFlags ?? {}) };
  const mergedRecord = merged as Record<string, unknown>;
  const parentRecord = (parentFlags ?? {}) as Record<string, unknown>;
  for (const key of REPLAY_PARENT_FLAG_KEYS) {
    if (mergedRecord[key] === undefined && parentRecord[key] !== undefined) {
      mergedRecord[key] = parentRecord[key];
    }
  }
  return merged;
}

function formatReplayActionSummary(action: SessionAction): string {
  return formatScriptActionSummary(action);
}

async function healReplayAction(params: {
  action: SessionAction;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatch: typeof dispatchCommand;
}): Promise<SessionAction | null> {
  const { action, sessionName, logPath, sessionStore, dispatch } = params;
  if (!(isClickLikeCommand(action.command) || ['fill', 'get', 'is', 'wait'].includes(action.command))) return null;
  const session = sessionStore.get(sessionName);
  if (!session) return null;
  const requiresRect = isClickLikeCommand(action.command) || action.command === 'fill';
  const allowDisambiguation =
    isClickLikeCommand(action.command) ||
    action.command === 'fill' ||
    (action.command === 'get' && action.positionals?.[0] === 'text');
  const snapshot = await captureSnapshotForReplay(session, action, logPath, requiresRect, dispatch, sessionStore);
  const selectorCandidates = collectReplaySelectorCandidates(action);
  for (const candidate of selectorCandidates) {
    const chain = tryParseSelectorChain(candidate);
    if (!chain) continue;
    const resolved = resolveSelectorChain(snapshot.nodes, chain, {
      platform: session.device.platform,
      requireRect: requiresRect,
      requireUnique: true,
      disambiguateAmbiguous: allowDisambiguation,
    });
    if (!resolved) continue;
    const selectorChain = buildSelectorChainForNode(resolved.node, session.device.platform, {
      action: isClickLikeCommand(action.command) ? 'click' : action.command === 'fill' ? 'fill' : 'get',
    });
    const selectorExpression = selectorChain.join(' || ');
    if (isClickLikeCommand(action.command)) {
      return {
        ...action,
        positionals: [selectorExpression],
      };
    }
    if (action.command === 'fill') {
      const fillText = inferFillText(action);
      if (!fillText) continue;
      return {
        ...action,
        positionals: [selectorExpression, fillText],
      };
    }
    if (action.command === 'get') {
      const sub = action.positionals?.[0];
      if (sub !== 'text' && sub !== 'attrs') continue;
      return {
        ...action,
        positionals: [sub, selectorExpression],
      };
    }
    if (action.command === 'is') {
      const { predicate, split } = splitIsSelectorArgs(action.positionals);
      if (!predicate) continue;
      const expectedText = split?.rest.join(' ').trim() ?? '';
      const nextPositionals = [predicate, selectorExpression];
      if (predicate === 'text' && expectedText.length > 0) {
        nextPositionals.push(expectedText);
      }
      return {
        ...action,
        positionals: nextPositionals,
      };
    }
    if (action.command === 'wait') {
      const { selectorTimeout } = parseSelectorWaitPositionals(action.positionals ?? []);
      const nextPositionals = [selectorExpression];
      if (selectorTimeout) {
        nextPositionals.push(selectorTimeout);
      }
      return {
        ...action,
        positionals: nextPositionals,
      };
    }
  }
  const numericDriftHeal = healNumericGetTextDrift(action, snapshot, session);
  if (numericDriftHeal) {
    return numericDriftHeal;
  }
  return null;
}

async function captureSnapshotForReplay(
  session: SessionState,
  action: SessionAction,
  logPath: string,
  interactiveOnly: boolean,
  dispatch: typeof dispatchCommand,
  sessionStore: SessionStore,
): Promise<SnapshotState> {
  const data = (await dispatch(session.device, 'snapshot', [], action.flags?.out, {
    ...contextFromFlags(
      logPath,
      {
        ...(action.flags ?? {}),
        snapshotInteractiveOnly: interactiveOnly,
        snapshotCompact: interactiveOnly,
      },
      session.appBundleId,
      session.trace?.outPath,
    ),
  })) as {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android';
  };
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(action.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  const snapshot: SnapshotState = {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
  session.snapshot = snapshot;
  sessionStore.set(session.name, session);
  return snapshot;
}

function collectReplaySelectorCandidates(action: SessionAction): string[] {
  const result: string[] = [];
  const explicitChain =
    Array.isArray(action.result?.selectorChain) &&
    action.result?.selectorChain.every((entry) => typeof entry === 'string')
      ? (action.result.selectorChain as string[])
      : [];
  result.push(...explicitChain);

  if (isClickLikeCommand(action.command)) {
    const first = action.positionals?.[0] ?? '';
    if (first && !first.startsWith('@')) {
      result.push(action.positionals.join(' '));
    }
  }
  if (action.command === 'fill') {
    const first = action.positionals?.[0] ?? '';
    if (first && !first.startsWith('@') && Number.isNaN(Number(first))) {
      result.push(first);
    }
  }
  if (action.command === 'get') {
    const selector = action.positionals?.[1] ?? '';
    if (selector && !selector.startsWith('@')) {
      result.push(action.positionals.slice(1).join(' '));
    }
  }
  if (action.command === 'is') {
    const { split } = splitIsSelectorArgs(action.positionals);
    if (split) {
      result.push(split.selectorExpression);
    }
  }
  if (action.command === 'wait') {
    const { selectorExpression } = parseSelectorWaitPositionals(action.positionals ?? []);
    if (selectorExpression) {
      result.push(selectorExpression);
    }
  }

  const refLabel = typeof action.result?.refLabel === 'string' ? action.result.refLabel.trim() : '';
  if (refLabel.length > 0) {
    const quoted = JSON.stringify(refLabel);
    if (action.command === 'fill') {
      result.push(`id=${quoted} editable=true`);
      result.push(`label=${quoted} editable=true`);
      result.push(`text=${quoted} editable=true`);
      result.push(`value=${quoted} editable=true`);
    } else {
      result.push(`id=${quoted}`);
      result.push(`label=${quoted}`);
      result.push(`text=${quoted}`);
      result.push(`value=${quoted}`);
    }
  }

  return uniqueStrings(result).filter((entry) => entry.trim().length > 0);
}

function parseSelectorWaitPositionals(positionals: string[]): {
  selectorExpression: string | null;
  selectorTimeout: string | null;
} {
  if (positionals.length === 0) return { selectorExpression: null, selectorTimeout: null };
  const maybeTimeout = positionals[positionals.length - 1];
  const hasTimeout = /^\d+$/.test(maybeTimeout ?? '');
  const selectorTokens = hasTimeout ? positionals.slice(0, -1) : positionals.slice();
  const split = splitSelectorFromArgs(selectorTokens);
  if (!split || split.rest.length > 0) {
    return { selectorExpression: null, selectorTimeout: null };
  }
  return {
    selectorExpression: split.selectorExpression,
    selectorTimeout: hasTimeout ? maybeTimeout : null,
  };
}

function healNumericGetTextDrift(
  action: SessionAction,
  snapshot: SnapshotState,
  session: SessionState,
): SessionAction | null {
  if (action.command !== 'get') return null;
  if (action.positionals?.[0] !== 'text') return null;
  const selectorExpression = action.positionals?.[1];
  if (!selectorExpression) return null;
  const chain = tryParseSelectorChain(selectorExpression);
  if (!chain) return null;

  const roleFilters = new Set<string>();
  let hasNumericTerm = false;
  for (const selector of chain.selectors) {
    for (const term of selector.terms) {
      if (term.key === 'role' && typeof term.value === 'string') {
        roleFilters.add(normalizeType(term.value));
      }
      if (
        (term.key === 'text' || term.key === 'label' || term.key === 'value') &&
        typeof term.value === 'string' &&
        /^\d+$/.test(term.value.trim())
      ) {
        hasNumericTerm = true;
      }
    }
  }
  if (!hasNumericTerm) return null;

  const numericNodes = snapshot.nodes.filter((node) => {
    const text = extractNodeText(node).trim();
    if (!/^\d+$/.test(text)) return false;
    if (roleFilters.size === 0) return true;
    return roleFilters.has(normalizeType(node.type ?? ''));
  });
  if (numericNodes.length === 0) return null;
  const numericValues = uniqueStrings(numericNodes.map((node) => extractNodeText(node).trim()));
  if (numericValues.length !== 1) return null;

  const targetNode = numericNodes[0];
  if (!targetNode) return null;
  const selectorChain = buildSelectorChainForNode(targetNode, session.device.platform, { action: 'get' });
  if (selectorChain.length === 0) return null;
  return {
    ...action,
    positionals: ['text', selectorChain.join(' || ')],
  };
}

function parseReplayScript(script: string): SessionAction[] {
  const actions: SessionAction[] = [];
  const lines = script.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseReplayScriptLine(line);
    if (parsed) {
      actions.push(parsed);
    }
  }
  return actions;
}

function parseReplayScriptLine(line: string): SessionAction | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null;
  const tokens = tokenizeReplayLine(trimmed);
  if (tokens.length === 0) return null;
  const [command, ...args] = tokens;
  if (command === 'context') return null;

  const action: SessionAction = {
    ts: Date.now(),
    command,
    positionals: [],
    flags: {},
  };

  if (command === 'snapshot') {
    action.positionals = [];
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === '-i') {
        action.flags.snapshotInteractiveOnly = true;
        continue;
      }
      if (token === '-c') {
        action.flags.snapshotCompact = true;
        continue;
      }
      if (token === '--raw') {
        action.flags.snapshotRaw = true;
        continue;
      }
      if ((token === '-d' || token === '--depth') && index + 1 < args.length) {
        const parsedDepth = Number(args[index + 1]);
        if (Number.isFinite(parsedDepth) && parsedDepth >= 0) {
          action.flags.snapshotDepth = Math.floor(parsedDepth);
        }
        index += 1;
        continue;
      }
      if ((token === '-s' || token === '--scope') && index + 1 < args.length) {
        action.flags.snapshotScope = args[index + 1];
        index += 1;
        continue;
      }
      if (token === '--backend' && index + 1 < args.length) {
        // Backward compatibility: ignore legacy snapshot backend token.
        index += 1;
        continue;
      }
    }
    return action;
  }

  if (command === 'open') {
    action.positionals = [];
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === '--relaunch') {
        action.flags.relaunch = true;
        continue;
      }
      action.positionals.push(token);
    }
    return action;
  }

  if (isClickLikeCommand(command)) {
    const parsed = parseReplaySeriesFlags(command, args);
    Object.assign(action.flags, parsed.flags);
    if (parsed.positionals.length === 0) return action;
    const target = parsed.positionals[0];
    if (target.startsWith('@')) {
      action.positionals = [target];
      if (parsed.positionals[1]) {
        action.result = { refLabel: parsed.positionals[1] };
      }
      return action;
    }
    const maybeX = parsed.positionals[0];
    const maybeY = parsed.positionals[1];
    if (isNumericToken(maybeX) && isNumericToken(maybeY) && parsed.positionals.length >= 2) {
      action.positionals = [maybeX, maybeY];
      return action;
    }
    action.positionals = [parsed.positionals.join(' ')];
    return action;
  }

  if (command === 'fill') {
    if (args.length < 2) {
      action.positionals = args;
      return action;
    }
    const target = args[0];
    if (target.startsWith('@')) {
      if (args.length >= 3) {
        action.positionals = [target, args.slice(2).join(' ')];
        action.result = { refLabel: args[1] };
        return action;
      }
      action.positionals = [target, args[1]];
      return action;
    }
    action.positionals = [target, args.slice(1).join(' ')];
    return action;
  }

  if (command === 'get') {
    if (args.length < 2) {
      action.positionals = args;
      return action;
    }
    const sub = args[0];
    const target = args[1];
    if (target.startsWith('@')) {
      action.positionals = [sub, target];
      if (args[2]) {
        action.result = { refLabel: args[2] };
      }
      return action;
    }
    action.positionals = [sub, args.slice(1).join(' ')];
    return action;
  }

  if (command === 'swipe') {
    const parsed = parseReplaySeriesFlags(command, args);
    Object.assign(action.flags, parsed.flags);
    action.positionals = parsed.positionals;
    return action;
  }

  action.positionals = args;
  return action;
}

function isNumericToken(token: string | undefined): token is string {
  if (!token) return false;
  return !Number.isNaN(Number(token));
}

function tokenizeReplayLine(line: string): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor])) {
      cursor += 1;
    }
    if (cursor >= line.length) break;
    if (line[cursor] === '"') {
      let end = cursor + 1;
      let escaped = false;
      while (end < line.length) {
        const char = line[end];
        if (char === '"' && !escaped) break;
        escaped = char === '\\' && !escaped;
        if (char !== '\\') escaped = false;
        end += 1;
      }
      if (end >= line.length) {
        throw new AppError('INVALID_ARGS', `Invalid replay script line: ${line}`);
      }
      const literal = line.slice(cursor, end + 1);
      tokens.push(JSON.parse(literal) as string);
      cursor = end + 1;
      continue;
    }
    let end = cursor;
    while (end < line.length && !/\s/.test(line[end])) {
      end += 1;
    }
    tokens.push(line.slice(cursor, end));
    cursor = end;
  }
  return tokens;
}

function writeReplayScript(filePath: string, actions: SessionAction[], session?: SessionState) {
  const lines: string[] = [];
  // Session can be missing if the replay session is closed/deleted between execution and update write.
  // In that case we still persist healed actions and omit only the context header.
  if (session) {
    const deviceLabel = session.device.name.replace(/"/g, '\\"');
    const kind = session.device.kind ? ` kind=${session.device.kind}` : '';
    const target = session.device.target ? ` target=${session.device.target}` : '';
    lines.push(`context platform=${session.device.platform}${target} device="${deviceLabel}"${kind} theme=unknown`);
  }
  for (const action of actions) {
    lines.push(formatReplayActionLine(action));
  }
  const serialized = `${lines.join('\n')}\n`;
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, serialized);
  fs.renameSync(tmpPath, filePath);
}

function formatReplayActionLine(action: SessionAction): string {
  const parts: string[] = [action.command];
  if (action.command === 'snapshot') {
    if (action.flags?.snapshotInteractiveOnly) parts.push('-i');
    if (action.flags?.snapshotCompact) parts.push('-c');
    if (typeof action.flags?.snapshotDepth === 'number') {
      parts.push('-d', String(action.flags.snapshotDepth));
    }
    if (action.flags?.snapshotScope) {
      parts.push('-s', formatScriptArg(action.flags.snapshotScope));
    }
    if (action.flags?.snapshotRaw) parts.push('--raw');
    return parts.join(' ');
  }
  if (action.command === 'open') {
    for (const positional of action.positionals ?? []) {
      parts.push(formatScriptArg(positional));
    }
    if (action.flags?.relaunch) {
      parts.push('--relaunch');
    }
    return parts.join(' ');
  }
  for (const positional of action.positionals ?? []) {
    parts.push(formatScriptArg(positional));
  }
  appendScriptSeriesFlags(parts, action);
  return parts.join(' ');
}
