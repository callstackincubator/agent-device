import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import { parseSessionSurface, type SessionSurface } from '../../core/session-surface.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { contextFromFlags } from '../context.ts';
import { resolveFrontmostMacOsApp } from '../../platforms/ios/macos-helper.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { applyRuntimeHintsToApp, clearRuntimeHintsFromApp } from '../runtime-hints.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse, SessionRuntimeHints, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import {
  classifyAndroidAppTarget,
  formatAndroidInstalledPackageRequiredMessage,
} from '../../platforms/android/open-target.ts';
import {
  IOS_SIMULATOR_POST_CLOSE_SETTLE_MS,
  IOS_SIMULATOR_POST_OPEN_SETTLE_MS,
  refreshSessionDeviceIfNeeded,
  settleIosSimulator,
} from './session-device-utils.ts';
import {
  countConfiguredRuntimeHints,
  maybeClearRemovedRuntimeTransportHints,
  setSessionRuntimeHintsForOpen,
  tryResolveOpenRuntimeHints,
} from './session-runtime.ts';
import {
  resolveAndroidPackageForOpen,
  resolveSessionAppBundleIdForTarget,
} from './session-open-target.ts';
import { STARTUP_SAMPLE_METHOD, type StartupPerfSample } from './session-startup-metrics.ts';
import { AppError } from '../../utils/errors.ts';

function buildOpenResult(params: {
  sessionName: string;
  appName?: string;
  appBundleId?: string;
  surface: SessionSurface;
  startup?: StartupPerfSample;
  device?: DeviceInfo;
  runtime?: SessionRuntimeHints;
}): Record<string, unknown> {
  const { sessionName, appName, appBundleId, surface, startup, device, runtime } = params;
  const result: Record<string, unknown> = { session: sessionName };
  result.surface = surface;
  if (appName) result.appName = appName;
  if (appBundleId) result.appBundleId = appBundleId;
  if (startup) result.startup = startup;
  if (runtime && countConfiguredRuntimeHints(runtime) > 0) {
    result.runtime = runtime;
  }
  if (device) {
    result.platform = device.platform;
    result.target = device.target ?? 'mobile';
    result.device = device.name;
    result.id = device.id;
    result.kind = device.kind;
    if (device.platform === 'android') {
      result.serial = device.id;
    }
  }
  if (device?.platform === 'ios') {
    result.device_udid = device.id;
    result.ios_simulator_device_set = device.simulatorSetPath ?? null;
  }
  return result;
}

function buildNextOpenSession(params: {
  existingSession?: SessionState;
  sessionName: string;
  device: DeviceInfo;
  surface: SessionSurface;
  appBundleId?: string;
  appName?: string;
  saveScript: boolean;
}): SessionState {
  const { existingSession, sessionName, device, surface, appBundleId, appName, saveScript } =
    params;
  if (existingSession) {
    return {
      ...existingSession,
      device,
      surface,
      appBundleId,
      appName,
      recordSession: existingSession.recordSession || saveScript,
      snapshot: undefined,
    };
  }
  return {
    name: sessionName,
    device,
    createdAt: Date.now(),
    surface,
    appBundleId,
    appName,
    recordSession: saveScript,
    actions: [],
  };
}

function resolveOpenSurface(
  device: DeviceInfo,
  surfaceFlag: string | undefined,
  openTarget: string | undefined,
): SessionSurface {
  if (device.platform !== 'macos') {
    if (surfaceFlag) {
      throw new AppError('INVALID_ARGS', 'surface is only supported on macOS');
    }
    return 'app';
  }
  const surface = surfaceFlag ? parseSessionSurface(surfaceFlag) : 'app';
  if (surface !== 'app' && openTarget) {
    throw new AppError('INVALID_ARGS', `open --surface ${surface} does not accept an app target`);
  }
  return surface;
}

function resolveRequestedOpenSurface(params: {
  device: DeviceInfo;
  surfaceFlag: string | undefined;
  openTarget: string | undefined;
  existingSurface?: SessionSurface;
}): SessionSurface {
  const { device, surfaceFlag, openTarget, existingSurface } = params;
  if (device.platform === 'macos') {
    if (!surfaceFlag) {
      return existingSurface ?? 'app';
    }
    return resolveOpenSurface(device, surfaceFlag, openTarget);
  }
  return resolveOpenSurface(device, surfaceFlag, openTarget);
}

async function resolveMacOsSurfaceAppState(
  surface: SessionSurface,
): Promise<{ appBundleId?: string; appName?: string }> {
  if (surface === 'app' || surface === 'desktop' || surface === 'menubar') {
    return {};
  }
  const frontmost = await resolveFrontmostMacOsApp();
  return {
    appBundleId: frontmost.bundleId,
    appName: frontmost.appName,
  };
}

async function relaunchCloseApp(params: {
  device: DeviceInfo;
  closeTarget: string;
  stopIosRunner: (deviceId: string) => Promise<void>;
  dispatch: typeof dispatchCommand;
  outFlag: string | undefined;
  context: Parameters<typeof dispatchCommand>[4];
  settleSimulator: (device: DeviceInfo, delayMs: number) => Promise<void>;
}): Promise<void> {
  const { device, closeTarget, stopIosRunner, dispatch, outFlag, context, settleSimulator } =
    params;
  if (device.platform !== 'android') {
    await stopIosRunner(device.id);
  }
  await dispatch(device, 'close', [closeTarget], outFlag, context);
  await settleSimulator(device, IOS_SIMULATOR_POST_CLOSE_SETTLE_MS);
}

async function maybeApplySessionLaunchUrl(params: {
  runtime: SessionRuntimeHints | undefined;
  device: DeviceInfo;
  dispatch: typeof dispatchCommand;
  req: DaemonRequest;
  logPath: string;
  appBundleId?: string;
  traceLogPath?: string;
  openPositionals: string[];
}): Promise<void> {
  const { runtime, device, dispatch, req, logPath, appBundleId, traceLogPath, openPositionals } =
    params;
  const launchUrl = runtime?.launchUrl;
  if (!launchUrl) return;
  if (openPositionals.length === 0) return;
  if (openPositionals.length > 1) return;
  const openTarget = openPositionals[0]?.trim();
  if (!openTarget || isDeepLinkTarget(openTarget)) return;
  await dispatch(device, 'open', [launchUrl], req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, appBundleId, traceLogPath),
  });
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

async function completeOpenCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  logPath: string;
  device: DeviceInfo;
  dispatch: typeof dispatchCommand;
  applyRuntimeHints: typeof applyRuntimeHintsToApp;
  stopIosRunner: typeof stopIosRunnerSession;
  settleSimulator: typeof settleIosSimulator;
  openTarget?: string;
  openPositionals: string[];
  appName?: string;
  surface: SessionSurface;
  appBundleId?: string;
  runtime: SessionRuntimeHints | undefined;
  existingSession?: SessionState;
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    sessionStore,
    logPath,
    device,
    dispatch,
    applyRuntimeHints,
    stopIosRunner,
    settleSimulator,
    openTarget,
    openPositionals,
    appName,
    surface,
    appBundleId,
    runtime,
    existingSession,
  } = params;
  const shouldRelaunch = req.flags?.relaunch === true;
  const traceLogPath = existingSession?.trace?.outPath;

  if (shouldRelaunch && openTarget) {
    const closeTarget = appBundleId ?? openTarget;
    await relaunchCloseApp({
      device,
      closeTarget,
      stopIosRunner,
      dispatch,
      outFlag: req.flags?.out,
      context: {
        ...contextFromFlags(
          logPath,
          req.flags,
          appBundleId ?? existingSession?.appBundleId,
          traceLogPath,
        ),
      },
      settleSimulator,
    });
  }

  await applyRuntimeHints({
    device,
    appId: appBundleId,
    runtime,
  });
  const openStartedAtMs = Date.now();
  await dispatch(device, 'open', openPositionals, req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, appBundleId),
  });
  await maybeApplySessionLaunchUrl({
    runtime,
    device,
    dispatch,
    req,
    logPath,
    appBundleId,
    traceLogPath,
    openPositionals,
  });
  const startupSample = openTarget
    ? buildStartupPerfSample(openStartedAtMs, openTarget, appBundleId)
    : undefined;
  await settleSimulator(device, IOS_SIMULATOR_POST_OPEN_SETTLE_MS);

  const nextSession = buildNextOpenSession({
    existingSession,
    sessionName,
    device,
    surface,
    appBundleId,
    appName,
    saveScript: Boolean(req.flags?.saveScript),
  });
  if (req.runtime !== undefined) {
    setSessionRuntimeHintsForOpen(sessionStore, sessionName, runtime);
  }
  const openResult = buildOpenResult({
    sessionName,
    appName,
    appBundleId,
    surface,
    startup: startupSample,
    device,
    runtime,
  });
  sessionStore.recordAction(nextSession, {
    command: 'open',
    positionals: openPositionals,
    flags: req.flags ?? {},
    runtime: req.runtime !== undefined ? runtime : undefined,
    result: openResult,
  });
  sessionStore.set(sessionName, nextSession);
  return { ok: true, data: openResult };
}

export async function handleOpenCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatch: typeof dispatchCommand;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  applyRuntimeHints?: typeof applyRuntimeHintsToApp;
  clearRuntimeHints?: typeof clearRuntimeHintsFromApp;
  stopIosRunner?: typeof stopIosRunnerSession;
  settleSimulator?: typeof settleIosSimulator;
  resolveAndroidPackageForOpen?: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>;
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    dispatch,
    ensureReady,
    resolveDevice,
    applyRuntimeHints = applyRuntimeHintsToApp,
    clearRuntimeHints = clearRuntimeHintsFromApp,
    stopIosRunner = stopIosRunnerSession,
    settleSimulator = settleIosSimulator,
    resolveAndroidPackageForOpen: resolveAndroidPackageForOpenFn = resolveAndroidPackageForOpen,
  } = params;
  const shouldRelaunch = req.flags?.relaunch === true;

  if (sessionStore.has(sessionName)) {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `Session "${sessionName}" not found.`,
        },
      };
    }
    const requestedOpenTarget = req.positionals?.[0];
    const openTarget = requestedOpenTarget ?? (shouldRelaunch ? session.appName : undefined);
    let requestedSurface: SessionSurface;
    try {
      requestedSurface = resolveRequestedOpenSurface({
        device: session.device,
        surfaceFlag: req.flags?.surface,
        openTarget,
        existingSurface: session.surface,
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof AppError ? error.code : 'INVALID_ARGS',
          message: String((error as Error).message),
        },
      };
    }
    if (!session || (!openTarget && requestedSurface === 'app')) {
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
    if (shouldRelaunch && requestedSurface !== 'app') {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'open --relaunch is supported only for app surfaces.',
        },
      };
    }
    if (
      shouldRelaunch &&
      session.device.platform === 'android' &&
      classifyAndroidAppTarget(openTarget) === 'binary'
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: formatAndroidInstalledPackageRequiredMessage(openTarget),
        },
      };
    }
    const device = await refreshSessionDeviceIfNeeded(session.device, resolveDevice);
    await ensureReady(device);
    const macOsSurfaceState = await resolveMacOsSurfaceAppState(requestedSurface);
    const appBundleId =
      macOsSurfaceState.appBundleId ??
      (await resolveSessionAppBundleIdForTarget(
        device,
        openTarget,
        session.appBundleId,
        resolveAndroidPackageForOpenFn,
      ));
    const appName = macOsSurfaceState.appName ?? openTarget;
    const runtimeResult = tryResolveOpenRuntimeHints({
      req,
      sessionStore,
      sessionName,
      device,
    });
    if (!runtimeResult.ok) {
      return runtimeResult.response;
    }
    const { runtime, previousRuntime, replacedStoredRuntime } = runtimeResult.data;
    await maybeClearRemovedRuntimeTransportHints({
      replacedStoredRuntime,
      previousRuntime,
      runtime,
      session,
      clearRuntimeHints,
    });
    const openPositionals = requestedOpenTarget
      ? (req.positionals ?? [])
      : openTarget
        ? [openTarget]
        : [];
    return await completeOpenCommand({
      req,
      sessionName,
      sessionStore,
      logPath,
      device,
      dispatch,
      applyRuntimeHints,
      stopIosRunner,
      settleSimulator,
      openTarget,
      openPositionals,
      appName,
      surface: requestedSurface,
      appBundleId,
      runtime,
      existingSession: session,
    });
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
  let surface: SessionSurface;
  try {
    surface = resolveRequestedOpenSurface({
      device,
      surfaceFlag: req.flags?.surface,
      openTarget,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof AppError ? error.code : 'INVALID_ARGS',
        message: String((error as Error).message),
      },
    };
  }
  if (shouldRelaunch && surface !== 'app') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'open --relaunch is supported only for app surfaces.',
      },
    };
  }
  if (
    shouldRelaunch &&
    device.platform === 'android' &&
    openTarget &&
    classifyAndroidAppTarget(openTarget) === 'binary'
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: formatAndroidInstalledPackageRequiredMessage(openTarget),
      },
    };
  }
  const inUse = sessionStore.toArray().find((session) => session.device.id === device.id);
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
  const macOsSurfaceState = await resolveMacOsSurfaceAppState(surface);
  const appBundleId =
    macOsSurfaceState.appBundleId ??
    (await resolveSessionAppBundleIdForTarget(
      device,
      openTarget,
      undefined,
      resolveAndroidPackageForOpenFn,
    ));
  const appName = macOsSurfaceState.appName ?? openTarget;
  const runtimeResult = tryResolveOpenRuntimeHints({
    req,
    sessionStore,
    sessionName,
    device,
  });
  if (!runtimeResult.ok) {
    return runtimeResult.response;
  }
  const { runtime } = runtimeResult.data;
  return await completeOpenCommand({
    req,
    sessionName,
    sessionStore,
    logPath,
    device,
    dispatch,
    applyRuntimeHints,
    stopIosRunner,
    settleSimulator,
    openTarget,
    openPositionals: req.positionals ?? [],
    appName,
    surface,
    appBundleId,
    runtime,
  });
}
