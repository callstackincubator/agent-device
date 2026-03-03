import { AppError } from '../utils/errors.ts';
import { normalizePlatformSelector, selectDevice, type DeviceInfo } from '../utils/device.ts';
import { listAndroidDevices } from '../platforms/android/devices.ts';
import { ensureAdb } from '../platforms/android/index.ts';
import { listIosDevices } from '../platforms/ios/devices.ts';
import { withDiagnosticTimer } from '../utils/diagnostics.ts';
import { resolveAndroidSerialAllowlist, resolveIosSimulatorDeviceSetPath } from '../utils/device-isolation.ts';
import type { CliFlags } from '../utils/command-schema.ts';

type ResolveDeviceFlags = Pick<
  CliFlags,
  'platform' | 'target' | 'device' | 'udid' | 'serial' | 'iosSimulatorDeviceSet' | 'androidDeviceAllowlist'
>;

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
        return await selectDevice(devices, selector);
      }

      if (selector.platform === 'ios') {
        const devices = await listIosDevices({ simulatorSetPath: iosSimulatorSetPath });
        return await selectDevice(devices, selector);
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
      return await selectDevice(devices, selector);
    },
    {
      platform: normalizedPlatform,
      target: flags.target,
    },
  );
}
