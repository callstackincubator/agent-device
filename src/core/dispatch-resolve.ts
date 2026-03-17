import { AppError } from '../utils/errors.ts';
import { normalizePlatformSelector, resolveDevice, type DeviceInfo } from '../utils/device.ts';
import { listAndroidDevices } from '../platforms/android/devices.ts';
import { ensureAdb } from '../platforms/android/index.ts';
import { findBootableIosSimulator, listIosDevices } from '../platforms/ios/devices.ts';
import { withDiagnosticTimer } from '../utils/diagnostics.ts';
import {
  resolveAndroidSerialAllowlist,
  resolveIosSimulatorDeviceSetPath,
} from '../utils/device-isolation.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import type { DeviceTarget } from '../utils/device.ts';

type ResolveDeviceFlags = Pick<
  CliFlags,
  | 'platform'
  | 'target'
  | 'device'
  | 'udid'
  | 'serial'
  | 'iosSimulatorDeviceSet'
  | 'androidDeviceAllowlist'
>;

type IosDeviceSelector = {
  platform?: 'ios';
  target?: DeviceTarget;
  deviceName?: string;
  udid?: string;
  serial?: string;
};

type ResolveIosDeviceDeps = {
  resolveDevice: typeof resolveDevice;
  findBootableSimulator: typeof findBootableIosSimulator;
};

/**
 * Resolves the best iOS device given pre-fetched candidates.  When no explicit
 * device selector was used, physical devices are rejected in favour of a
 * bootable simulator discovered via `findBootableSimulator`.
 *
 * Exported for testing; production callers should use `resolveTargetDevice`.
 */
export async function resolveIosDevice(
  devices: DeviceInfo[],
  selector: IosDeviceSelector,
  context: { simulatorSetPath?: string },
  deps: ResolveIosDeviceDeps,
): Promise<DeviceInfo> {
  const hasExplicitSelector = !!(selector.udid || selector.serial || selector.deviceName);

  let selected: DeviceInfo | undefined;
  try {
    selected = await deps.resolveDevice(devices, selector, context);
  } catch (err) {
    // When resolveDevice throws DEVICE_NOT_FOUND and no explicit device
    // selector was used, attempt the simulator fallback before giving up.
    if (hasExplicitSelector || !(err instanceof AppError) || err.code !== 'DEVICE_NOT_FOUND') {
      throw err;
    }
  }

  // When no explicit device selector was used and auto-selection either
  // picked a physical device or found nothing at all, try to find an
  // available simulator instead.  Physical devices should only be used
  // when explicitly targeted.
  if (!hasExplicitSelector && (!selected || selected.kind === 'device')) {
    const simulator = await deps.findBootableSimulator({
      simulatorSetPath: context.simulatorSetPath,
      target: selector.target,
    });
    if (simulator) return simulator;
  }

  if (selected) return selected;
  throw new AppError('DEVICE_NOT_FOUND', 'No devices found', { selector });
}

export async function resolveTargetDevice(flags: ResolveDeviceFlags): Promise<DeviceInfo> {
  const normalizedPlatform = normalizePlatformSelector(flags.platform);
  const iosSimulatorSetPath = resolveIosSimulatorDeviceSetPath(flags.iosSimulatorDeviceSet);
  const androidSerialAllowlist = resolveAndroidSerialAllowlist(flags.androidDeviceAllowlist);
  return await withDiagnosticTimer(
    'resolve_target_device',
    async () => {
      const selector = {
        platform: normalizedPlatform,
        target: flags.target,
        deviceName: flags.device,
        udid: flags.udid,
        serial: flags.serial,
      };
      if (selector.target && !selector.platform) {
        throw new AppError(
          'INVALID_ARGS',
          'Device target selector requires --platform. Use --platform ios|android|apple with --target mobile|tv.',
        );
      }

      if (selector.platform === 'android') {
        await ensureAdb();
        const devices = await listAndroidDevices({ serialAllowlist: androidSerialAllowlist });
        return await resolveDevice(devices, selector);
      }

      if (selector.platform === 'ios') {
        const devices = await listIosDevices({ simulatorSetPath: iosSimulatorSetPath });
        return await resolveIosDevice(
          devices,
          selector as IosDeviceSelector,
          { simulatorSetPath: iosSimulatorSetPath },
          { resolveDevice, findBootableSimulator: findBootableIosSimulator },
        );
      }

      const devices: DeviceInfo[] = [];
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
      return await resolveDevice(devices, selector, { simulatorSetPath: iosSimulatorSetPath });
    },
    {
      platform: normalizedPlatform,
      target: flags.target,
    },
  );
}
