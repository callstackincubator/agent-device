import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import type { SessionSurface } from '../../core/session-surface.ts';
import { contextFromFlags } from '../context.ts';
import { createRequestCanceledError, isRequestCanceled } from '../request-cancel.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { applyRuntimeHintsToApp } from '../runtime-hints.ts';
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
import { STARTUP_SAMPLE_METHOD, type StartupPerfSample } from './session-startup-metrics.ts';
import { buildNextOpenSession, buildOpenResult } from './session-open-surface.ts';
import { markAndroidSnapshotFreshness } from '../android-snapshot-freshness.ts';
import { resetAndroidFramePerfStats } from '../../platforms/android/perf.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { inferAndroidPackageAfterOpen } from './session-open-target.ts';
import {
  invalidOpenArgs,
  prepareOpenCommandDetails,
  resolveOpenSurfaceResponse,
  validatePreResolvedOpenRequest,
  validateResolvedOpenRequest,
} from './session-open-prepare.ts';
import { errorResponse } from './response.ts';

const firstSessionOpenLocks = new Map<string, Promise<unknown>>();

async function relaunchCloseApp(params: {
  device: DeviceInfo;
  closeTarget: string;
  outFlag: string | undefined;
  context: Parameters<typeof dispatchCommand>[4];
}): Promise<void> {
  const { device, closeTarget, outFlag, context } = params;
  if (device.platform !== 'android') {
    await stopIosRunnerSession(device.id);
  }
  await dispatchCommand(device, 'close', [closeTarget], outFlag, context);
  await settleIosSimulator(device, IOS_SIMULATOR_POST_CLOSE_SETTLE_MS);
}

async function maybeApplySessionLaunchUrl(params: {
  runtime: SessionRuntimeHints | undefined;
  device: DeviceInfo;
  req: DaemonRequest;
  logPath: string;
  appBundleId?: string;
  traceLogPath?: string;
  openPositionals: string[];
}): Promise<void> {
  const { runtime, device, req, logPath, appBundleId, traceLogPath, openPositionals } = params;
  const launchUrl = runtime?.launchUrl;
  if (!launchUrl) return;
  if (openPositionals.length === 0) return;
  if (openPositionals.length > 1) return;
  const openTarget = openPositionals[0]?.trim();
  if (!openTarget || isDeepLinkTarget(openTarget)) return;
  await dispatchCommand(device, 'open', [launchUrl], req.flags?.out, {
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

// fallow-ignore-next-line complexity
async function completeOpenCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  logPath: string;
  device: DeviceInfo;
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
  let sessionAppBundleId = appBundleId;

  if (shouldRelaunch && openTarget) {
    const closeTarget = sessionAppBundleId ?? openTarget;
    await relaunchCloseApp({
      device,
      closeTarget,
      outFlag: req.flags?.out,
      context: {
        ...contextFromFlags(
          logPath,
          req.flags,
          sessionAppBundleId ?? existingSession?.appBundleId,
          traceLogPath,
        ),
      },
    });
  }

  await applyRuntimeHintsToApp({
    device,
    appId: sessionAppBundleId,
    runtime,
  });
  const openStartedAtMs = Date.now();
  await dispatchCommand(device, 'open', openPositionals, req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, sessionAppBundleId),
  });
  await maybeApplySessionLaunchUrl({
    runtime,
    device,
    req,
    logPath,
    appBundleId: sessionAppBundleId,
    traceLogPath,
    openPositionals,
  });
  sessionAppBundleId = await inferAndroidPackageAfterOpen(device, openTarget, sessionAppBundleId);
  if (device.platform === 'android' && sessionAppBundleId) {
    await resetAndroidFramePerfStats(device, sessionAppBundleId);
  }
  const startupSample = openTarget
    ? buildStartupPerfSample(openStartedAtMs, openTarget, sessionAppBundleId)
    : undefined;
  await settleIosSimulator(device, IOS_SIMULATOR_POST_OPEN_SETTLE_MS);
  if (isRequestCanceled(req.meta?.requestId)) {
    const canceled = createRequestCanceledError();
    return errorResponse(canceled.code, canceled.message, canceled.details);
  }

  if (existingSession) {
    // Mark freshness before buildNextOpenSession clears the stored snapshot. `open` is one of
    // the few nav-sensitive commands that would otherwise lose its pre-action baseline.
    markAndroidSnapshotFreshness(existingSession, 'open', existingSession.snapshot);
  }
  const nextSession = buildNextOpenSession({
    existingSession,
    sessionName,
    device,
    surface,
    appBundleId: sessionAppBundleId,
    appName,
    saveScript: Boolean(req.flags?.saveScript),
  });
  if (req.runtime !== undefined) {
    setSessionRuntimeHintsForOpen(sessionStore, sessionName, runtime);
  }
  const openResult = buildOpenResult({
    sessionName,
    appName,
    appBundleId: sessionAppBundleId,
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
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;

  if (sessionStore.has(sessionName)) {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return errorResponse('SESSION_NOT_FOUND', `Session "${sessionName}" not found.`);
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

    const device = await refreshSessionDeviceIfNeeded(session.device);
    const details = await prepareOpenCommandDetails({
      req,
      sessionName,
      sessionStore,
      device,
      surface: surfaceResult,
      openTarget,
      existingSession: session,
    });
    if (details.type === 'response') {
      return details.response;
    }

    return await completeOpenCommand({
      req,
      sessionName,
      sessionStore,
      logPath,
      device,
      openTarget,
      openPositionals: requestedOpenTarget
        ? (req.positionals ?? [])
        : openTarget
          ? [openTarget]
          : [],
      appBundleId: details.details.appBundleId,
      appName: details.details.appName,
      runtime: details.details.runtime,
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

  const device = await resolveTargetDevice(req.flags ?? {});
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

  return await withKeyedLock(firstSessionOpenLocks, device.id, async () => {
    const inUse = sessionStore
      .toArray()
      .find((activeSession) => activeSession.device.id === device.id);
    if (inUse) {
      return errorResponse(
        'DEVICE_IN_USE',
        `Device is already in use by session "${inUse.name}".`,
        { session: inUse.name, deviceId: device.id, deviceName: device.name },
      );
    }

    const details = await prepareOpenCommandDetails({
      req,
      sessionName,
      sessionStore,
      device,
      surface: surfaceResult,
      openTarget,
    });
    if (details.type === 'response') {
      return details.response;
    }

    return await completeOpenCommand({
      req,
      sessionName,
      sessionStore,
      logPath,
      device,
      openTarget,
      openPositionals: req.positionals ?? [],
      appBundleId: details.details.appBundleId,
      appName: details.details.appName,
      runtime: details.details.runtime,
      surface: surfaceResult,
    });
  });
}
