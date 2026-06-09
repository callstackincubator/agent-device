import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import {
  parsePermissionAction,
  parsePermissionTarget,
  type SettingOptions,
} from '../permission-utils.ts';
import { parseAppearanceAction } from '../appearance.ts';
import { parseSettingState } from '../setting-state.ts';
import { runHarmonyHdc } from './hdc.ts';
import { clearHarmonyAppStorage } from './app-lifecycle.ts';

export async function setHarmonySetting(
  device: DeviceInfo,
  setting: string,
  state: string,
  appPackage?: string,
  options?: SettingOptions,
): Promise<Record<string, unknown> | void> {
  const normalized = setting.toLowerCase();
  switch (normalized) {
    case 'wifi': {
      const enabled = parseSettingState(state);
      // HarmonyOS uses param to control network settings
      await runHarmonyHdc(device, [
        'shell',
        'param',
        'set',
        'persist.sys.wifi.enabled',
        enabled ? 'true' : 'false',
      ]);
      return;
    }
    case 'airplane': {
      const enabled = parseSettingState(state);
      await runHarmonyHdc(device, [
        'shell',
        'param',
        'set',
        'persist.sys.airplane_mode',
        enabled ? 'true' : 'false',
      ]);
      return;
    }
    case 'location': {
      const enabled = parseSettingState(state);
      await runHarmonyHdc(device, [
        'shell',
        'param',
        'set',
        'persist.sys.location.enabled',
        enabled ? 'true' : 'false',
      ]);
      return;
    }
    case 'animations': {
      const enabled = parseSettingState(state);
      const scale = enabled ? '1' : '0';
      await runHarmonyHdc(device, ['shell', 'param', 'set', 'persist.sys.animation.scale', scale]);
      return { scale };
    }
    case 'appearance': {
      const target = await resolveHarmonyAppearanceTarget(device, state);
      await runHarmonyHdc(device, ['shell', 'param', 'set', 'persist.sys.appearance.mode', target]);
      return;
    }
    case 'permission': {
      if (!appPackage) {
        throw new AppError('INVALID_ARGS', 'permission setting requires an active app in session');
      }
      const action = parsePermissionAction(state);
      const target = parseHarmonyPermissionTarget(options?.permissionTarget);
      await setHarmonyPermission(device, appPackage, action, target);
      return;
    }
    case 'bluetooth': {
      const enabled = parseSettingState(state);
      await runHarmonyHdc(device, [
        'shell',
        'param',
        'set',
        'persist.sys.bluetooth.enabled',
        enabled ? 'true' : 'false',
      ]);
      return;
    }
    case 'volume': {
      const level = Math.max(0, Math.min(100, Number.parseInt(state, 10)));
      if (!Number.isFinite(level)) {
        throw new AppError('INVALID_ARGS', `Invalid volume level: ${state}. Use 0-100.`);
      }
      await runHarmonyHdc(device, [
        'shell',
        'param',
        'set',
        'persist.sys.volume.media',
        String(level),
      ]);
      return { level };
    }
    case 'brightness': {
      const level = Math.max(0, Math.min(100, Number.parseInt(state, 10)));
      if (!Number.isFinite(level)) {
        throw new AppError('INVALID_ARGS', `Invalid brightness level: ${state}. Use 0-100.`);
      }
      await runHarmonyHdc(device, [
        'shell',
        'param',
        'set',
        'persist.sys.brightness',
        String(level),
      ]);
      return { level };
    }
    case 'clear-app-state': {
      if (state.toLowerCase() !== 'clear') {
        throw new AppError('INVALID_ARGS', 'settings clear-app-state only supports clear.');
      }
      if (!appPackage) {
        throw new AppError(
          'INVALID_ARGS',
          'settings clear-app-state requires an app id or an active app session.',
        );
      }
      const result = await clearHarmonyAppStorage(device, appPackage);
      return { bundleId: result.bundleId, clearedData: result.clearedData, clearedCache: result.clearedCache };
    }
    default:
      throw new AppError('INVALID_ARGS', `Unsupported HarmonyOS setting: ${setting}`);
  }
}

async function resolveHarmonyAppearanceTarget(device: DeviceInfo, state: string): Promise<string> {
  const action = parseAppearanceAction(state);
  if (action !== 'toggle') return action;

  const currentResult = await runHarmonyHdc(
    device,
    ['shell', 'param', 'get', 'persist.sys.appearance.mode'],
    { allowFailure: true },
  );

  if (currentResult.exitCode !== 0) {
    // Default to dark if we can't read current state
    return 'dark';
  }

  const current = currentResult.stdout.trim().toLowerCase();
  return current === 'dark' ? 'light' : 'dark';
}

function parseHarmonyPermissionTarget(permissionTarget: string | undefined): string {
  const normalized = parsePermissionTarget(permissionTarget);
  // HarmonyOS permission names differ from Android
  const harmonyPermissions: Record<string, string> = {
    camera: 'ohos.permission.CAMERA',
    microphone: 'ohos.permission.MICROPHONE',
    photos: 'ohos.permission.READ_MEDIA',
    contacts: 'ohos.permission.READ_CONTACTS',
    notifications: 'ohos.permission.NOTIFICATION_CONTROLLER',
  };

  const permission = harmonyPermissions[normalized];
  if (!permission) {
    throw new AppError(
      'INVALID_ARGS',
      `Unsupported permission target on HarmonyOS: ${permissionTarget}. Use camera|microphone|photos|contacts|notifications.`,
    );
  }
  return permission;
}

async function setHarmonyPermission(
  device: DeviceInfo,
  appPackage: string,
  action: 'grant' | 'deny' | 'reset',
  permission: string,
): Promise<void> {
  // HarmonyOS permission management uses different commands than Android
  // This is a simplified implementation - actual HarmonyOS may need specific APIs
  if (action === 'deny') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'HarmonyOS permission deny is not yet implemented',
    );
  }
  if (action === 'reset') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'HarmonyOS permission reset is not yet implemented',
    );
  }

  // Only grant is supported for now
  const result = await runHarmonyHdc(
    device,
    ['shell', 'bm', 'grant-permission', '-n', appPackage, '-p', permission],
    { allowFailure: true },
  );

  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `Failed to set HarmonyOS permission: ${result.stderr}`, {
      appPackage,
      permission,
      action,
    });
  }
}

export async function getHarmonySetting(device: DeviceInfo, setting: string): Promise<string> {
  const normalized = setting.toLowerCase();
  const paramMap: Record<string, string> = {
    wifi: 'persist.sys.wifi.enabled',
    airplane: 'persist.sys.airplane_mode',
    location: 'persist.sys.location.enabled',
    animations: 'persist.sys.animation.scale',
    appearance: 'persist.sys.appearance.mode',
    bluetooth: 'persist.sys.bluetooth.enabled',
    volume: 'persist.sys.volume.media',
    brightness: 'persist.sys.brightness',
  };

  const paramKey = paramMap[normalized];
  if (!paramKey) {
    throw new AppError('INVALID_ARGS', `Unsupported HarmonyOS setting: ${setting}`);
  }

  const result = await runHarmonyHdc(device, ['shell', 'param', 'get', paramKey], {
    allowFailure: true,
  });

  if (result.exitCode !== 0) {
    return '';
  }

  return result.stdout.trim();
}
