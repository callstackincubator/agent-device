import { resolveTargetDevice } from '../../core/dispatch.ts';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse, SessionRuntimeHints, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import {
  classifyAndroidAppTarget,
  formatAndroidInstalledPackageRequiredMessage,
} from '../../platforms/android/open-target.ts';
import { refreshSessionDeviceIfNeeded } from './session-device-utils.ts';
import {
  maybeClearRemovedRuntimeTransportHints,
  tryResolveOpenRuntimeHints,
} from './session-runtime.ts';
import { resolveSessionAppBundleIdForTarget } from './session-open-target.ts';
import { AppError } from '../../utils/errors.ts';
import {
  resolveMacOsSurfaceAppState,
  resolveRequestedOpenSurface,
} from './session-open-surface.ts';
import type { SessionSurface } from '../../core/session-surface.ts';
import { clearRuntimeHintsFromApp } from '../runtime-hints.ts';

type PreparedOpenCommand = {
  device: DeviceInfo;
  surface: SessionSurface;
  openTarget?: string;
  openPositionals: string[];
  appBundleId?: string;
  appName?: string;
  runtime: SessionRuntimeHints | undefined;
  existingSession?: SessionState;
};

function invalidArgs(message: string): DaemonResponse {
  return {
    ok: false,
    error: {
      code: 'INVALID_ARGS',
      message,
    },
  };
}

function toSurfaceResponse(
  device: DeviceInfo,
  surfaceFlag: string | undefined,
  openTarget: string | undefined,
  existingSurface?: SessionSurface,
): SessionSurface | DaemonResponse {
  try {
    return resolveRequestedOpenSurface({
      device,
      surfaceFlag,
      openTarget,
      existingSurface,
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
}

function validatePreparedOpenRequest(params: {
  shouldRelaunch: boolean;
  openTarget: string | undefined;
  surface: SessionSurface;
  device: DeviceInfo;
}): DaemonResponse | null {
  const { shouldRelaunch, openTarget, surface, device } = params;
  if (!shouldRelaunch) return null;
  if (openTarget && isDeepLinkTarget(openTarget)) {
    return invalidArgs('open --relaunch does not support URL targets.');
  }
  if (surface !== 'app') {
    return invalidArgs('open --relaunch is supported only for app surfaces.');
  }
  if (
    device.platform === 'android' &&
    openTarget &&
    classifyAndroidAppTarget(openTarget) === 'binary'
  ) {
    return invalidArgs(formatAndroidInstalledPackageRequiredMessage(openTarget));
  }
  return null;
}

async function prepareResolvedOpenCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  device: DeviceInfo;
  surface: SessionSurface;
  openTarget: string | undefined;
  openPositionals: string[];
  ensureReady: typeof ensureDeviceReady;
  resolveAndroidPackageForOpen: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>;
  existingSession?: SessionState;
  clearRuntimeHints?: typeof clearRuntimeHintsFromApp;
}): Promise<{ response: DaemonResponse } | { prepared: PreparedOpenCommand }> {
  const {
    req,
    sessionName,
    sessionStore,
    device,
    surface,
    openTarget,
    openPositionals,
    ensureReady,
    resolveAndroidPackageForOpen,
    existingSession,
    clearRuntimeHints,
  } = params;
  const validation = validatePreparedOpenRequest({
    shouldRelaunch: req.flags?.relaunch === true,
    openTarget,
    surface,
    device,
  });
  if (validation) {
    return { response: validation };
  }

  await ensureReady(device);
  const { appBundleId, appName } = await resolvePreparedOpenIdentity({
    device,
    surface,
    openTarget,
    existingAppBundleId: existingSession?.appBundleId,
    resolveAndroidPackageForOpen,
  });
  const runtimeResult = tryResolveOpenRuntimeHints({
    req,
    sessionStore,
    sessionName,
    device,
  });
  if (!runtimeResult.ok) {
    return { response: runtimeResult.response };
  }

  if (existingSession && clearRuntimeHints) {
    const { runtime, previousRuntime, replacedStoredRuntime } = runtimeResult.data;
    await maybeClearRemovedRuntimeTransportHints({
      replacedStoredRuntime,
      previousRuntime,
      runtime,
      session: existingSession,
      clearRuntimeHints,
    });
  }

  return {
    prepared: {
      device,
      surface,
      openTarget,
      openPositionals,
      appBundleId,
      appName,
      runtime: runtimeResult.data.runtime,
      existingSession,
    },
  };
}

async function resolvePreparedOpenIdentity(params: {
  device: DeviceInfo;
  surface: SessionSurface;
  openTarget: string | undefined;
  existingAppBundleId?: string;
  resolveAndroidPackageForOpen: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>;
}): Promise<{ appBundleId?: string; appName?: string }> {
  const { device, surface, openTarget, existingAppBundleId, resolveAndroidPackageForOpen } = params;
  const macOsSurfaceState = await resolveMacOsSurfaceAppState(surface);
  return {
    appBundleId:
      macOsSurfaceState.appBundleId ??
      (await resolveSessionAppBundleIdForTarget(
        device,
        openTarget,
        existingAppBundleId,
        resolveAndroidPackageForOpen,
      )),
    appName: macOsSurfaceState.appName ?? openTarget,
  };
}

export async function prepareExistingOpenCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  session: SessionState;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  clearRuntimeHints: typeof clearRuntimeHintsFromApp;
  resolveAndroidPackageForOpen: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>;
}): Promise<{ response: DaemonResponse } | { prepared: PreparedOpenCommand }> {
  const {
    req,
    sessionName,
    sessionStore,
    session,
    ensureReady,
    resolveDevice,
    clearRuntimeHints,
    resolveAndroidPackageForOpen,
  } = params;
  const shouldRelaunch = req.flags?.relaunch === true;
  const requestedOpenTarget = req.positionals?.[0];
  const openTarget = requestedOpenTarget ?? (shouldRelaunch ? session.appName : undefined);
  const surfaceResult = toSurfaceResponse(
    session.device,
    req.flags?.surface,
    openTarget,
    session.surface,
  );
  if (typeof surfaceResult !== 'string') {
    return { response: surfaceResult };
  }

  if (!openTarget && surfaceResult === 'app') {
    return {
      response: shouldRelaunch
        ? invalidArgs('open --relaunch requires an app name or an active session app.')
        : invalidArgs('Session already active. Close it first or pass a new --session name.'),
    };
  }

  const device = await refreshSessionDeviceIfNeeded(session.device, resolveDevice);
  return await prepareResolvedOpenCommand({
    req,
    sessionName,
    sessionStore,
    device,
    surface: surfaceResult,
    openTarget,
    openPositionals: requestedOpenTarget ? (req.positionals ?? []) : openTarget ? [openTarget] : [],
    ensureReady,
    resolveAndroidPackageForOpen,
    clearRuntimeHints,
    existingSession: session,
  });
}

export async function prepareNewOpenCommand(params: {
  req: DaemonRequest;
  sessionStore: SessionStore;
  sessionName: string;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  resolveAndroidPackageForOpen: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>;
}): Promise<{ response: DaemonResponse } | { prepared: PreparedOpenCommand }> {
  const {
    req,
    sessionStore,
    sessionName,
    ensureReady,
    resolveDevice,
    resolveAndroidPackageForOpen,
  } = params;
  const shouldRelaunch = req.flags?.relaunch === true;
  const openTarget = req.positionals?.[0];
  if (shouldRelaunch && !openTarget) {
    return { response: invalidArgs('open --relaunch requires an app argument.') };
  }

  const device = await resolveDevice(req.flags ?? {});
  const surfaceResult = toSurfaceResponse(device, req.flags?.surface, openTarget);
  if (typeof surfaceResult !== 'string') {
    return { response: surfaceResult };
  }

  const inUse = sessionStore.toArray().find((session) => session.device.id === device.id);
  if (inUse) {
    return {
      response: {
        ok: false,
        error: {
          code: 'DEVICE_IN_USE',
          message: `Device is already in use by session "${inUse.name}".`,
          details: { session: inUse.name, deviceId: device.id, deviceName: device.name },
        },
      },
    };
  }

  return await prepareResolvedOpenCommand({
    req,
    sessionName,
    sessionStore,
    device,
    surface: surfaceResult,
    openTarget,
    openPositionals: req.positionals ?? [],
    ensureReady,
    resolveAndroidPackageForOpen,
  });
}
