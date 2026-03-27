import {
  matchesPlatformSelector,
  normalizePlatformSelector,
  type DeviceInfo,
} from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { resolveTimeoutMs } from '../../utils/timeouts.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { resolveTargetDevice } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';

export const IOS_SIMULATOR_POST_CLOSE_SETTLE_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_SIMULATOR_POST_CLOSE_SETTLE_MS,
  300,
  0,
);

export const IOS_SIMULATOR_POST_OPEN_SETTLE_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_SIMULATOR_POST_OPEN_SETTLE_MS,
  300,
  0,
);

export function requireSessionOrExplicitSelector(
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

export function hasExplicitDeviceSelector(flags: DaemonRequest['flags'] | undefined): boolean {
  return Boolean(flags?.platform || flags?.target || flags?.device || flags?.udid || flags?.serial);
}

export function hasExplicitSessionFlag(flags: DaemonRequest['flags'] | undefined): boolean {
  return typeof flags?.session === 'string' && flags.session.trim().length > 0;
}

export function isIosSimulator(device: DeviceInfo): boolean {
  return device.platform === 'ios' && device.kind === 'simulator';
}

export function isAndroidEmulator(device: DeviceInfo): boolean {
  return device.platform === 'android' && device.kind === 'emulator';
}

export async function settleIosSimulator(device: DeviceInfo, delayMs: number): Promise<void> {
  if (!isIosSimulator(device) || delayMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function resolveCommandDevice(params: {
  session: SessionState | undefined;
  flags: DaemonRequest['flags'] | undefined;
  ensureReady?: boolean;
}): Promise<DeviceInfo> {
  const shouldUseExplicitSelector = hasExplicitDeviceSelector(params.flags);
  const device =
    shouldUseExplicitSelector || !params.session
      ? await resolveTargetDevice(params.flags ?? {})
      : await refreshSessionDeviceIfNeeded(params.session.device);
  if (params.ensureReady !== false) {
    await ensureDeviceReady(device);
  }
  return device;
}

export async function refreshSessionDeviceIfNeeded(device: DeviceInfo): Promise<DeviceInfo> {
  if (device.platform !== 'ios' || device.kind !== 'simulator') {
    return device;
  }
  if (process.platform !== 'darwin') {
    return device;
  }

  const exactSelector: NonNullable<DaemonRequest['flags']> = {
    platform: 'ios',
    target: device.target,
    udid: device.id,
    ...(device.simulatorSetPath ? { iosSimulatorDeviceSet: device.simulatorSetPath } : {}),
  };
  try {
    return await resolveTargetDevice(exactSelector);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'DEVICE_NOT_FOUND') {
      throw error;
    }
  }

  return await resolveTargetDevice({
    platform: 'ios',
    target: device.target,
    device: device.name,
    ...(device.simulatorSetPath ? { iosSimulatorDeviceSet: device.simulatorSetPath } : {}),
  });
}

export function resolveAndroidEmulatorAvdName(params: {
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

export function selectorTargetsSessionDevice(
  flags: DaemonRequest['flags'] | undefined,
  session: SessionState | undefined,
): boolean {
  if (!session) return false;
  if (!hasExplicitDeviceSelector(flags)) return true;
  const normalizedPlatform = normalizePlatformSelector(flags?.platform);
  if (normalizedPlatform && !matchesPlatformSelector(session.device.platform, normalizedPlatform)) {
    return false;
  }
  if (flags?.target && flags.target !== (session.device.target ?? 'mobile')) return false;
  if (flags?.udid && flags.udid !== session.device.id) return false;
  if (flags?.serial && flags.serial !== session.device.id) return false;
  if (flags?.device) {
    return flags.device.trim().toLowerCase() === session.device.name.trim().toLowerCase();
  }
  return true;
}
