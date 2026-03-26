import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { resolvePayloadInput } from '../../utils/payload-input.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { runMacOsAlertAction } from '../../platforms/ios/macos-helper.ts';
import { shutdownSimulator } from '../../platforms/ios/simulator.ts';
import { applyRuntimeHintsToApp, clearRuntimeHintsFromApp } from '../runtime-hints.ts';
import { startAppLog, stopAppLog } from '../app-log.ts';
import {
  handleInstallFromSourceCommand,
  handleReleaseMaterializedPathsCommand,
} from './install-source.ts';
import {
  requireSessionOrExplicitSelector,
  resolveCommandDevice,
  settleIosSimulator,
} from './session-device-utils.ts';
import { handleRuntimeCommand } from './session-runtime-command.ts';
import { handleOpenCommand } from './session-open.ts';
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
import { handleSessionInventoryCommands } from './session-inventory.ts';
import { handleSessionStateCommands, type EnsureAndroidEmulatorBoot } from './session-state.ts';
import { handleSessionObservabilityCommands } from './session-observability.ts';
import { handleSessionReplayCommands } from './session-replay.ts';

type ListAndroidDevices = typeof import('../../platforms/android/devices.ts').listAndroidDevices;
type ListAppleDevices = typeof import('../../platforms/ios/devices.ts').listAppleDevices;

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
  dismissMacOsAlert?: typeof runMacOsAlertAction;
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
    dismissMacOsAlert = runMacOsAlertAction,
    appLogOps = {
      start: startAppLog,
      stop: stopAppLog,
    },
    ensureAndroidEmulatorBoot = defaultEnsureAndroidEmulatorBoot,
    resolveAndroidPackageForOpen:
      resolveAndroidPackageForOpenOverride = resolveAndroidPackageForOpen,
    applyRuntimeHints: applyRuntimeHintsOverride = applyRuntimeHintsToApp,
    clearRuntimeHints: clearRuntimeHintsOverride = clearRuntimeHintsFromApp,
    settleSimulator: settleSimulatorOverride,
    shutdownSimulator: shutdownSimulatorOverride,
    shutdownAndroidEmulator: shutdownAndroidEmulatorOverride,
    listAndroidDevices,
    listAppleDevices,
    listAppleApps,
  } = params;

  const dispatch = dispatchOverride ?? dispatchCommand;
  const ensureReady = ensureReadyOverride ?? ensureDeviceReady;
  const resolveDevice = resolveTargetDeviceOverride ?? resolveTargetDevice;
  const stopIosRunner = stopIosRunnerOverride ?? stopIosRunnerSession;
  const settleSimulator = settleSimulatorOverride ?? settleIosSimulator;
  const applyRuntimeHints = applyRuntimeHintsOverride;
  const clearRuntimeHints = clearRuntimeHintsOverride;
  const doShutdownSimulator = shutdownSimulatorOverride ?? shutdownSimulator;

  const inventoryResponse = await handleSessionInventoryCommands({
    req,
    sessionName,
    sessionStore,
    ensureReady,
    resolveDevice,
    listAndroidDevices,
    listAppleDevices,
    listAppleApps,
  });
  if (inventoryResponse) return inventoryResponse;

  if (req.command === 'runtime') {
    return await handleRuntimeCommand({
      req,
      sessionName,
      sessionStore,
      clearRuntimeHints,
    });
  }

  const stateResponse = await handleSessionStateCommands({
    req,
    sessionName,
    sessionStore,
    ensureReady,
    resolveDevice,
    ensureAndroidEmulatorBoot,
  });
  if (stateResponse) return stateResponse;

  if (req.command === 'clipboard') {
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

  if (req.command === 'keyboard') {
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

  const observabilityResponse = await handleSessionObservabilityCommands({
    req,
    sessionName,
    sessionStore,
    appLogOps,
  });
  if (observabilityResponse) return observabilityResponse;

  if (req.command === 'install' || req.command === 'reinstall') {
    return await handleAppDeployCommand({
      req,
      command: req.command,
      sessionName,
      sessionStore,
      ensureReady,
      resolveDevice,
      deployOps: req.command === 'install' ? installOps : reinstallOps,
    });
  }

  if (req.command === 'install_source') {
    return await handleInstallFromSourceCommand({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (req.command === 'release_materialized_paths') {
    return await handleReleaseMaterializedPathsCommand({ req });
  }

  if (req.command === 'push') {
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

    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      ensureReady,
      resolveDevice,
      dispatch,
      command: 'push',
      positionals: [appId, maybeResolvePushPayloadPath(payloadArg, req.meta?.cwd)],
      recordPositionals: [appId, payloadArg],
    });
  }

  if (req.command === 'trigger-app-event') {
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

  if (req.command === 'open') {
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

  const replayResponse = await handleSessionReplayCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
    dispatch,
    stopIosRunner,
    dismissMacOsAlert,
    clearRuntimeHints,
    settleSimulator,
    appLogOps: { stop: appLogOps.stop },
  });
  if (replayResponse) return replayResponse;

  if (req.command === 'batch') {
    return await runBatchCommands(req, sessionName, invoke);
  }

  if (req.command === 'close') {
    return await handleCloseCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
      dispatch,
      stopIosRunner,
      dismissMacOsAlert,
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
