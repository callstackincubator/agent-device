import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import type { SessionSurface } from '../../core/session-surface.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { contextFromFlags } from '../context.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { applyRuntimeHintsToApp, clearRuntimeHintsFromApp } from '../runtime-hints.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse, SessionRuntimeHints, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import {
  IOS_SIMULATOR_POST_CLOSE_SETTLE_MS,
  IOS_SIMULATOR_POST_OPEN_SETTLE_MS,
  refreshSessionDeviceIfNeeded,
  settleIosSimulator,
} from './session-device-utils.ts';
import { countConfiguredRuntimeHints, setSessionRuntimeHintsForOpen } from './session-runtime.ts';
import { resolveAndroidPackageForOpen } from './session-open-target.ts';
import { STARTUP_SAMPLE_METHOD, type StartupPerfSample } from './session-startup-metrics.ts';
import { buildNextOpenSession, buildOpenResult } from './session-open-surface.ts';
import {
  invalidOpenArgs,
  prepareOpenCommandDetails,
  resolveOpenSurfaceResponse,
  validatePreResolvedOpenRequest,
  validateResolvedOpenRequest,
} from './session-open-prepare.ts';

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
    runtimeHintCount: countConfiguredRuntimeHints,
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
    const shouldRelaunch = req.flags?.relaunch === true;
    const requestedOpenTarget = req.positionals?.[0];
    const openTarget = requestedOpenTarget ?? (shouldRelaunch ? session.appName : undefined);
    const surfaceResult = resolveOpenSurfaceResponse(
      session.device,
      req.flags?.surface,
      openTarget,
      session.surface,
    );
    if (typeof surfaceResult !== 'string') {
      return surfaceResult;
    }
    if (!openTarget && surfaceResult === 'app') {
      return shouldRelaunch
        ? invalidOpenArgs('open --relaunch requires an app name or an active session app.')
        : invalidOpenArgs('Session already active. Close it first or pass a new --session name.');
    }

    const validation = validateResolvedOpenRequest({
      shouldRelaunch,
      openTarget,
      surface: surfaceResult,
      device: session.device,
    });
    if (validation) {
      return validation;
    }

    const device = await refreshSessionDeviceIfNeeded(session.device, resolveDevice);
    const details = await prepareOpenCommandDetails({
      req,
      sessionName,
      sessionStore,
      device,
      surface: surfaceResult,
      openTarget,
      ensureReady,
      resolveAndroidPackageForOpen: resolveAndroidPackageForOpenFn,
      clearRuntimeHints,
      existingSession: session,
    });
    if ('ok' in details) {
      return details;
    }

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
      openPositionals: requestedOpenTarget
        ? (req.positionals ?? [])
        : openTarget
          ? [openTarget]
          : [],
      appBundleId: details.appBundleId,
      appName: details.appName,
      runtime: details.runtime,
      surface: surfaceResult,
      existingSession: session,
    });
  }

  const shouldRelaunch = req.flags?.relaunch === true;
  const openTarget = req.positionals?.[0];
  if (shouldRelaunch && !openTarget) {
    return invalidOpenArgs('open --relaunch requires an app argument.');
  }

  const preResolvedValidation = validatePreResolvedOpenRequest({
    shouldRelaunch,
    openTarget,
    platform: req.flags?.platform === 'android' ? 'android' : undefined,
  });
  if (preResolvedValidation) {
    return preResolvedValidation;
  }

  const device = await resolveDevice(req.flags ?? {});
  const surfaceResult = resolveOpenSurfaceResponse(device, req.flags?.surface, openTarget);
  if (typeof surfaceResult !== 'string') {
    return surfaceResult;
  }

  const validation = validateResolvedOpenRequest({
    shouldRelaunch,
    openTarget,
    surface: surfaceResult,
    device,
  });
  if (validation) {
    return validation;
  }

  const inUse = sessionStore
    .toArray()
    .find((activeSession) => activeSession.device.id === device.id);
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

  const details = await prepareOpenCommandDetails({
    req,
    sessionName,
    sessionStore,
    device,
    surface: surfaceResult,
    openTarget,
    ensureReady,
    resolveAndroidPackageForOpen: resolveAndroidPackageForOpenFn,
  });
  if ('ok' in details) {
    return details;
  }

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
    appBundleId: details.appBundleId,
    appName: details.appName,
    runtime: details.runtime,
    surface: surfaceResult,
  });
}
