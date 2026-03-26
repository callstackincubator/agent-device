import { resolveTargetDevice } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { asAppError } from '../../utils/errors.ts';
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
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { ensureSimulatorExists } from '../../platforms/ios/ensure-simulator.ts';
import { requireSessionOrExplicitSelector, resolveCommandDevice } from './session-device-utils.ts';

type ListAndroidDevices = typeof import('../../platforms/android/devices.ts').listAndroidDevices;
type ListAppleDevices = typeof import('../../platforms/ios/devices.ts').listAppleDevices;
type ListAppleApps = (
  device: DeviceInfo,
  filter: 'user-installed' | 'all',
) => Promise<Array<{ bundleId: string; name?: string }>>;

export async function handleSessionInventoryCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  listAndroidDevices?: ListAndroidDevices;
  listAppleDevices?: ListAppleDevices;
  listAppleApps?: ListAppleApps;
}): Promise<DaemonResponse | null> {
  const {
    req,
    sessionName,
    sessionStore,
    ensureReady,
    resolveDevice,
    listAndroidDevices: listAndroidDevicesOverride,
    listAppleDevices: listAppleDevicesOverride,
    listAppleApps: listAppleAppsOverride,
  } = params;

  if (req.command === 'session_list') {
    return {
      ok: true,
      data: {
        sessions: sessionStore.toArray().map((session) => ({
          name: session.name,
          platform: session.device.platform,
          target: session.device.target ?? 'mobile',
          surface: session.surface ?? 'app',
          device: session.device.name,
          id: session.device.id,
          device_id: session.device.id,
          createdAt: session.createdAt,
          ...(session.device.platform === 'ios' && {
            device_udid: session.device.id,
            ios_simulator_device_set: session.device.simulatorSetPath ?? null,
          }),
        })),
      },
    };
  }

  if (req.command === 'ensure-simulator') {
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

      const result = await ensureSimulatorExists({
        deviceName,
        runtime,
        simulatorSetPath: iosSimulatorSetPath,
        reuseExisting: flags.reuseExisting !== false,
        boot: flags.boot === true,
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

  if (req.command === 'devices') {
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
            // ignore discovery failures so the other platform can still respond
          }
        }

        const listAppleDevices =
          listAppleDevicesOverride ??
          (await import('../../platforms/ios/devices.ts')).listAppleDevices;
        try {
          devices.push(...(await listAppleDevices({ simulatorSetPath: iosSimulatorSetPath })));
        } catch {
          // ignore discovery failures so the other platform can still respond
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

  if (req.command === 'apps') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const guard = requireSessionOrExplicitSelector(req.command, session, flags);
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
      return {
        ok: true,
        data: {
          apps: apps.map((app) =>
            app.name && app.name !== app.bundleId ? `${app.name} (${app.bundleId})` : app.bundleId,
          ),
        },
      };
    }

    const { listAndroidApps } = await import('../../platforms/android/index.ts');
    const apps = await listAndroidApps(device, appsFilter);
    return {
      ok: true,
      data: {
        apps: apps.map((app) =>
          app.name && app.name !== app.package ? `${app.name} (${app.package})` : app.package,
        ),
      },
    };
  }

  return null;
}
