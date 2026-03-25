import fs from 'node:fs';
import {
  dispatchCommand,
  resolveTargetDevice,
  type BatchStep,
  type CommandFlags,
} from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { AppError, asAppError, normalizeError } from '../../utils/errors.ts';
import {
  isApplePlatform,
  normalizePlatformSelector,
  resolveAppleSimulatorSetPathForSelector,
  type DeviceInfo,
} from '../../utils/device.ts';
import {
  resolveAndroidSerialAllowlist,
  resolveIosSimulatorDeviceSetPath,
} from '../../utils/device-isolation.ts';
import type { DaemonRequest, DaemonResponse, SessionAction, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { shutdownSimulator } from '../../platforms/ios/simulator.ts';
import { attachRefs, type RawSnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { pruneGroupNodes } from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  resolveSelectorChain,
  splitIsSelectorArgs,
  tryParseSelectorChain,
} from '../selectors.ts';
import { inferFillText } from '../action-utils.ts';
import { formatScriptActionSummary, isClickLikeCommand } from '../script-utils.ts';
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
import { applyRuntimeHintsToApp, clearRuntimeHintsFromApp } from '../runtime-hints.ts';
import {
  collectReplaySelectorCandidates,
  healNumericGetTextDrift,
  parseSelectorWaitPositionals,
} from './session-replay-heal.ts';
import { parseReplayScript, writeReplayScript } from './session-replay-script.ts';
import {
  handleInstallFromSourceCommand,
  handleReleaseMaterializedPathsCommand,
} from './install-source.ts';
import { ensureSimulatorExists } from '../../platforms/ios/ensure-simulator.ts';
import {
  hasExplicitSessionFlag,
  requireSessionOrExplicitSelector,
  resolveAndroidEmulatorAvdName,
  resolveCommandDevice,
  selectorTargetsSessionDevice,
  settleIosSimulator,
} from './session-device-utils.ts';
import { handleRuntimeCommand } from './session-runtime-command.ts';
import { handleOpenCommand } from './session-open.ts';
import { buildPerfResponseData } from './session-perf.ts';
import {
  resolveAndroidPackageForOpen,
  resolveSessionAppBundleIdForTarget,
} from './session-open-target.ts';
import { handleCloseCommand, type ShutdownAndroidEmulatorFn } from './session-close.ts';
import {
  defaultInstallOps,
  defaultReinstallOps,
  handleAppDeployCommand,
  type InstallOps,
  type ReinstallOps,
} from './session-deploy.ts';
import { runBatchCommands } from './session-batch.ts';

type EnsureAndroidEmulatorBoot = (params: {
  avdName: string;
  serial?: string;
  headless?: boolean;
}) => Promise<DeviceInfo>;
type ListAndroidDevices = typeof import('../../platforms/android/devices.ts').listAndroidDevices;
type ListAppleDevices = typeof import('../../platforms/ios/devices.ts').listAppleDevices;

const IOS_APPSTATE_SESSION_REQUIRED_MESSAGE =
  'iOS appstate requires an active session on the target device. Run open first (for example: open --session sim --platform ios --device "<name>" <app>).';
const MACOS_APPSTATE_SESSION_REQUIRED_MESSAGE =
  'macOS appstate requires an active session on the target device. Run open first (for example: open --session macos --platform macos "System Settings").';
const REPLAY_PARENT_FLAG_KEYS: Array<keyof CommandFlags> = [
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'verbose',
  'out',
];
const LOG_ACTIONS = ['path', 'start', 'stop', 'doctor', 'mark', 'clear'] as const;
const LOG_ACTIONS_MESSAGE = `logs requires ${LOG_ACTIONS.slice(0, -1).join(', ')}, or ${LOG_ACTIONS.at(-1)}`;
const NETWORK_ACTIONS = ['dump', 'log'] as const;
const NETWORK_ACTIONS_MESSAGE = `network requires ${NETWORK_ACTIONS.join(' or ')}`;
const NETWORK_INCLUDE_MODES = ['summary', 'headers', 'body', 'all'] as const;
const NETWORK_INCLUDE_MESSAGE = `network include mode must be one of: ${NETWORK_INCLUDE_MODES.join(', ')}`;
type NetworkIncludeMode = (typeof NETWORK_INCLUDE_MODES)[number];

const defaultEnsureAndroidEmulatorBoot: EnsureAndroidEmulatorBoot = async ({
  avdName,
  serial,
  headless,
}) => {
  const { ensureAndroidEmulatorBooted } = await import('../../platforms/android/devices.ts');
  return await ensureAndroidEmulatorBooted({ avdName, serial, headless });
};

async function runSessionOrSelectorDispatch(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  dispatch: typeof dispatchCommand;
  command: string;
  positionals: string[];
  recordPositionals?: string[];
  deriveNextSession?: (
    session: SessionState,
    result: Record<string, unknown> | void,
    device: DeviceInfo,
  ) => Promise<SessionState> | SessionState;
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    ensureReady,
    resolveDevice,
    dispatch,
    command,
    positionals,
    recordPositionals,
    deriveNextSession,
  } = params;
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
  if (!isCommandSupportedOnDevice(command, device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `${command} is not supported on this device`,
      },
    };
  }

  const result = await dispatch(device, command, positionals, req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  });
  if (session) {
    const nextSession = deriveNextSession
      ? await deriveNextSession(session, result, device)
      : session;
    sessionStore.recordAction(nextSession, {
      command,
      positionals: recordPositionals ?? positionals,
      flags: req.flags ?? {},
      result: result ?? {},
    });
    if (nextSession !== session) {
      sessionStore.set(sessionName, nextSession);
    }
  }
  return { ok: true, data: result ?? {} };
}
function resolveSessionLogBackendLabel(
  session: SessionState,
): 'ios-simulator' | 'ios-device' | 'android' | 'macos' {
  if (session.appLog) {
    return session.appLog.backend;
  }
  if (session.device.platform === 'macos') {
    return 'macos';
  }
  if (session.device.platform === 'ios') {
    return session.device.kind === 'device' ? 'ios-device' : 'ios-simulator';
  }
  return 'android';
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

  const shouldUseSessionStateForApple =
    (session?.device.platform === 'ios' || session?.device.platform === 'macos') &&
    selectorTargetsSessionDevice(flags, session);
  const targetsIos = normalizedPlatform === 'ios';
  const targetsMacOs = normalizedPlatform === 'macos';
  if (targetsIos && !shouldUseSessionStateForApple) {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: IOS_APPSTATE_SESSION_REQUIRED_MESSAGE,
      },
    };
  }
  if (targetsMacOs && !shouldUseSessionStateForApple) {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: MACOS_APPSTATE_SESSION_REQUIRED_MESSAGE,
      },
    };
  }
  if (shouldUseSessionStateForApple && session) {
    const appName = session.appName ?? session.appBundleId;
    if (!session.appName && !session.appBundleId) {
      if (
        session.device.platform === 'macos' &&
        session.surface &&
        session.surface !== 'app' &&
        session.surface !== 'frontmost-app'
      ) {
        return {
          ok: true,
          data: {
            platform: session.device.platform,
            appName: session.surface,
            appBundleId: session.appBundleId,
            source: 'session',
            surface: session.surface,
          },
        };
      }
      const sessionPlatform = session.device.platform === 'macos' ? 'macOS' : 'iOS';
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `No foreground app is tracked for this ${sessionPlatform} session. Open an app in the session, then retry appstate.`,
        },
      };
    }
    return {
      ok: true,
      data: {
        platform: session.device.platform,
        appName: appName ?? 'unknown',
        appBundleId: session.appBundleId,
        source: 'session',
        surface: session.surface ?? 'app',
        ...(session.device.platform === 'ios'
          ? {
              device_udid: session.device.id,
              ios_simulator_device_set: session.device.simulatorSetPath ?? null,
            }
          : {}),
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
  if (device.platform === 'macos') {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: MACOS_APPSTATE_SESSION_REQUIRED_MESSAGE,
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
  installOps?: InstallOps;
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
  applyRuntimeHints?: typeof applyRuntimeHintsToApp;
  clearRuntimeHints?: typeof clearRuntimeHintsFromApp;
  settleSimulator?: typeof settleIosSimulator;
  shutdownSimulator?: typeof shutdownSimulator;
  shutdownAndroidEmulator?: ShutdownAndroidEmulatorFn;
  listAndroidDevices?: ListAndroidDevices;
  listAppleDevices?: ListAppleDevices;
  listAppleApps?: (
    device: DeviceInfo,
    filter: 'user-installed' | 'all',
  ) => Promise<Array<{ bundleId: string; name?: string }>>;
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
    installOps = defaultInstallOps,
    reinstallOps = defaultReinstallOps,
    stopIosRunner: stopIosRunnerOverride,
    appLogOps = {
      start: startAppLog,
      stop: stopAppLog,
    },
    ensureAndroidEmulatorBoot: ensureAndroidEmulatorBootOverride = defaultEnsureAndroidEmulatorBoot,
    resolveAndroidPackageForOpen:
      resolveAndroidPackageForOpenOverride = resolveAndroidPackageForOpen,
    applyRuntimeHints: applyRuntimeHintsOverride = applyRuntimeHintsToApp,
    clearRuntimeHints: clearRuntimeHintsOverride = clearRuntimeHintsFromApp,
    settleSimulator: settleSimulatorOverride,
    shutdownSimulator: shutdownSimulatorOverride,
    shutdownAndroidEmulator: shutdownAndroidEmulatorOverride,
    listAndroidDevices: listAndroidDevicesOverride,
    listAppleDevices: listAppleDevicesOverride,
    listAppleApps: listAppleAppsOverride,
  } = params;
  const dispatch = dispatchOverride ?? dispatchCommand;
  const ensureReady = ensureReadyOverride ?? ensureDeviceReady;
  const resolveDevice = resolveTargetDeviceOverride ?? resolveTargetDevice;
  const stopIosRunner = stopIosRunnerOverride ?? stopIosRunnerSession;
  const settleSimulator = settleSimulatorOverride ?? settleIosSimulator;
  const doShutdownSimulator = shutdownSimulatorOverride ?? shutdownSimulator;
  const applyRuntimeHints = applyRuntimeHintsOverride;
  const clearRuntimeHints = clearRuntimeHintsOverride;
  const command = req.command;

  if (command === 'session_list') {
    const data = {
      sessions: sessionStore.toArray().map((s) => ({
        name: s.name,
        platform: s.device.platform,
        target: s.device.target ?? 'mobile',
        surface: s.surface ?? 'app',
        device: s.device.name,
        id: s.device.id,
        device_id: s.device.id,
        createdAt: s.createdAt,
        ...(s.device.platform === 'ios' && {
          device_udid: s.device.id,
          ios_simulator_device_set: s.device.simulatorSetPath ?? null,
        }),
      })),
    };
    return { ok: true, data };
  }

  if (command === 'runtime') {
    return await handleRuntimeCommand({
      req,
      sessionName,
      sessionStore,
      clearRuntimeHints,
    });
  }

  if (command === 'ensure-simulator') {
    try {
      const flags = req.flags ?? {};
      const deviceName = flags.device;
      const runtime = flags.runtime;
      const iosSimulatorSetPath = resolveIosSimulatorDeviceSetPath(flags.iosSimulatorDeviceSet);
      if (!deviceName) {
        return {
          ok: false,
          error: { code: 'INVALID_ARGS', message: 'ensure-simulator requires --device <name>' },
        };
      }
      const shouldBoot = flags.boot === true;
      const reuseExisting = flags.reuseExisting !== false;
      const result = await ensureSimulatorExists({
        deviceName,
        runtime,
        simulatorSetPath: iosSimulatorSetPath,
        reuseExisting,
        boot: shouldBoot,
        ensureReady,
      });
      return {
        ok: true,
        data: {
          udid: result.udid,
          device: result.device,
          runtime: result.runtime,
          ios_simulator_device_set: iosSimulatorSetPath ?? null,
          created: result.created,
          booted: result.booted,
        },
      };
    } catch (err) {
      const appErr = asAppError(err);
      return {
        ok: false,
        error: { code: appErr.code, message: appErr.message, details: appErr.details },
      };
    }
  }

  if (command === 'devices') {
    try {
      const devices: DeviceInfo[] = [];
      const androidSerialAllowlist = resolveAndroidSerialAllowlist(
        req.flags?.androidDeviceAllowlist,
      );
      const requestedPlatform = normalizePlatformSelector(req.flags?.platform);
      const iosSimulatorSetPath = resolveAppleSimulatorSetPathForSelector({
        simulatorSetPath: resolveIosSimulatorDeviceSetPath(req.flags?.iosSimulatorDeviceSet),
        platform: requestedPlatform,
        target: req.flags?.target,
      });
      if (requestedPlatform === 'android') {
        const listAndroidDevices =
          listAndroidDevicesOverride ??
          (await import('../../platforms/android/devices.ts')).listAndroidDevices;
        devices.push(...(await listAndroidDevices({ serialAllowlist: androidSerialAllowlist })));
      } else if (requestedPlatform === 'ios' || requestedPlatform === 'macos') {
        const listAppleDevices =
          listAppleDevicesOverride ??
          (await import('../../platforms/ios/devices.ts')).listAppleDevices;
        devices.push(...(await listAppleDevices({ simulatorSetPath: iosSimulatorSetPath })));
      } else {
        if (requestedPlatform !== 'apple') {
          const listAndroidDevices =
            listAndroidDevicesOverride ??
            (await import('../../platforms/android/devices.ts')).listAndroidDevices;
          try {
            devices.push(
              ...(await listAndroidDevices({ serialAllowlist: androidSerialAllowlist })),
            );
          } catch {
            // ignore
          }
        }
        const listAppleDevices =
          listAppleDevicesOverride ??
          (await import('../../platforms/ios/devices.ts')).listAppleDevices;
        try {
          devices.push(...(await listAppleDevices({ simulatorSetPath: iosSimulatorSetPath })));
        } catch {
          // ignore
        }
      }
      const platformFiltered =
        requestedPlatform === 'ios' || requestedPlatform === 'macos'
          ? devices.filter((device) => device.platform === requestedPlatform)
          : devices;
      const filtered = req.flags?.target
        ? platformFiltered.filter((device) => (device.target ?? 'mobile') === req.flags?.target)
        : platformFiltered;
      const publicDevices = filtered.map(
        ({ simulatorSetPath: _simulatorSetPath, ...device }) => device,
      );
      return { ok: true, data: { devices: publicDevices } };
    } catch (err) {
      const appErr = asAppError(err);
      return {
        ok: false,
        error: { code: appErr.code, message: appErr.message, details: appErr.details },
      };
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
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'apps is not supported on this device' },
      };
    }
    const appsFilter = req.flags?.appsFilter ?? 'all';
    if (isApplePlatform(device.platform)) {
      const listAppleApps =
        listAppleAppsOverride ?? (await import('../../platforms/ios/index.ts')).listIosApps;
      const apps = await listAppleApps(device, appsFilter);
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
    const normalizedPlatform =
      normalizePlatformSelector(flags.platform) ?? session?.device.platform;
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
      if (
        targetsAndroid &&
        wantsAndroidHeadless &&
        !fallbackAvdName &&
        appErr.code === 'DEVICE_NOT_FOUND'
      ) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message:
              'boot --headless requires --device <avd-name> (or an Android emulator session target).',
          },
        };
      }
      if (
        !canFallbackLaunchAndroidEmulator ||
        appErr.code !== 'DEVICE_NOT_FOUND' ||
        !fallbackAvdName
      ) {
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
              message:
                'boot --headless requires --device <avd-name> (or an Android emulator session target).',
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
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'boot is not supported on this device' },
      };
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

  if (command === 'keyboard') {
    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      ensureReady,
      resolveDevice,
      dispatch,
      command: 'keyboard',
      positionals: req.positionals ?? [],
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

  if (command === 'install' || command === 'reinstall') {
    return await handleAppDeployCommand({
      req,
      command,
      sessionName,
      sessionStore,
      ensureReady,
      resolveDevice,
      deployOps: command === 'install' ? installOps : reinstallOps,
    });
  }

  if (command === 'install_source') {
    return await handleInstallFromSourceCommand({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (command === 'release_materialized_paths') {
    return await handleReleaseMaterializedPathsCommand({ req });
  }

  if (command === 'push') {
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
    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      ensureReady,
      resolveDevice,
      dispatch,
      command: 'push',
      positionals: [appId, normalizedPayloadArg],
      recordPositionals: [appId, payloadArg],
    });
  }

  if (command === 'trigger-app-event') {
    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      ensureReady,
      resolveDevice,
      dispatch,
      command: 'trigger-app-event',
      positionals: req.positionals ?? [],
      deriveNextSession: async (session, result) => {
        const eventUrl = typeof result?.eventUrl === 'string' ? result.eventUrl : undefined;
        const nextAppBundleId = eventUrl
          ? ((await resolveSessionAppBundleIdForTarget(
              session.device,
              eventUrl,
              session.appBundleId,
              resolveAndroidPackageForOpenOverride,
            )) ?? session.appBundleId)
          : session.appBundleId;
        return {
          ...session,
          appBundleId: nextAppBundleId,
        };
      },
    });
  }

  if (command === 'open') {
    return await handleOpenCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
      dispatch,
      ensureReady,
      resolveDevice,
      applyRuntimeHints,
      clearRuntimeHints,
      stopIosRunner,
      settleSimulator,
      resolveAndroidPackageForOpen: resolveAndroidPackageForOpenOverride,
    });
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
            message:
              'replay accepts .ad script files. JSON replay payloads are no longer supported.',
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
          runtime: action.runtime,
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
          runtime: nextAction.runtime,
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
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'logs requires an active session' },
      };
    }
    if (!isCommandSupportedOnDevice('logs', session.device)) {
      const unsupportedError = normalizeError(
        new AppError('UNSUPPORTED_OPERATION', 'logs is not supported on this device'),
      );
      return {
        ok: false,
        error: unsupportedError,
      };
    }
    const action = (req.positionals?.[0] ?? 'path').toLowerCase();
    const restart = Boolean(req.flags?.restart);
    if (!LOG_ACTIONS.includes(action as (typeof LOG_ACTIONS)[number])) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: LOG_ACTIONS_MESSAGE } };
    }
    if (restart && action !== 'clear') {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'logs --restart is only supported with logs clear',
        },
      };
    }
    if (action === 'path') {
      const logPath = sessionStore.resolveAppLogPath(sessionName);
      const metadata = getAppLogPathMetadata(logPath);
      const backend = resolveSessionLogBackendLabel(session);
      return {
        ok: true,
        data: {
          path: logPath,
          active: Boolean(session.appLog),
          state: session.appLog?.getState() ?? 'inactive',
          backend,
          sizeBytes: metadata.sizeBytes,
          modifiedAt: metadata.modifiedAt,
          startedAt: session.appLog?.startedAt
            ? new Date(session.appLog.startedAt).toISOString()
            : undefined,
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
          error: {
            code: 'INVALID_ARGS',
            message: 'logs clear requires logs to be stopped first; run logs stop',
          },
        };
      }
      if (restart) {
        if (!session.appBundleId) {
          return {
            ok: false,
            error: {
              code: 'INVALID_ARGS',
              message: 'logs clear --restart requires an app session; run open <app> first',
            },
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
          const appLogStream = await appLogOps.start(
            session.device,
            session.appBundleId as string,
            logPath,
            appLogPidPath,
          );
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
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'app log already streaming; run logs stop first',
          },
        };
      }
      if (!session.appBundleId) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'logs start requires an app session; run open <app> first',
          },
        };
      }
      const appLogPath = sessionStore.resolveAppLogPath(sessionName);
      const appLogPidPath = sessionStore.resolveAppLogPidPath(sessionName);
      try {
        const appLogStream = await appLogOps.start(
          session.device,
          session.appBundleId,
          appLogPath,
          appLogPidPath,
        );
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
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'network requires an active session' },
      };
    }
    if (!isCommandSupportedOnDevice('network', session.device)) {
      const unsupportedError = normalizeError(
        new AppError('UNSUPPORTED_OPERATION', 'network is not supported on this device'),
      );
      return {
        ok: false,
        error: unsupportedError,
      };
    }
    const action = (req.positionals?.[0] ?? 'dump').toLowerCase();
    if (!NETWORK_ACTIONS.includes(action as (typeof NETWORK_ACTIONS)[number])) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: NETWORK_ACTIONS_MESSAGE } };
    }

    const requestedLimit = req.positionals?.[1];
    const maxEntries = requestedLimit ? Number.parseInt(requestedLimit, 10) : 25;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 200) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'network dump limit must be an integer in range 1..200',
        },
      };
    }

    const requestedInclude = (req.positionals?.[2] ?? 'summary').toLowerCase();
    if (
      !NETWORK_INCLUDE_MODES.includes(requestedInclude as (typeof NETWORK_INCLUDE_MODES)[number])
    ) {
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
    const backend = resolveSessionLogBackendLabel(session);
    const notes: string[] = [];
    if (!session.appLog) {
      notes.push(
        'Capture uses the session app log file. For fresh traffic, run logs clear --restart before reproducing requests.',
      );
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
    return await handleCloseCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
      dispatch,
      stopIosRunner,
      clearRuntimeHints,
      settleSimulator,
      shutdownSimulator: doShutdownSimulator,
      shutdownAndroidEmulator: shutdownAndroidEmulatorOverride,
      appLogOps: {
        stop: appLogOps.stop,
      },
    });
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
  if (
    !(isClickLikeCommand(action.command) || ['fill', 'get', 'is', 'wait'].includes(action.command))
  )
    return null;
  const session = sessionStore.get(sessionName);
  if (!session) return null;
  const requiresRect = isClickLikeCommand(action.command) || action.command === 'fill';
  const allowDisambiguation =
    isClickLikeCommand(action.command) ||
    action.command === 'fill' ||
    (action.command === 'get' && action.positionals?.[0] === 'text');
  const snapshot = await captureSnapshotForReplay(
    session,
    action,
    logPath,
    requiresRect,
    dispatch,
    sessionStore,
  );
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
      action: isClickLikeCommand(action.command)
        ? 'click'
        : action.command === 'fill'
          ? 'fill'
          : 'get',
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
    backend?: 'xctest' | 'android' | 'macos-helper';
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
