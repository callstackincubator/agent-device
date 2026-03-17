import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import {
  parsePermissionAction,
  parsePermissionTarget,
  type PermissionSettingOptions,
} from '../permission-utils.ts';
import { parseAppearanceAction } from '../appearance.ts';
import { adbArgs } from './adb.ts';

export async function setAndroidSetting(
  device: DeviceInfo,
  setting: string,
  state: string,
  appPackage?: string,
  options?: PermissionSettingOptions,
): Promise<void> {
  const normalized = setting.toLowerCase();
  switch (normalized) {
    case 'wifi': {
      const enabled = parseSettingState(state);
      await runCmd(
        'adb',
        adbArgs(device, ['shell', 'svc', 'wifi', enabled ? 'enable' : 'disable']),
      );
      return;
    }
    case 'airplane': {
      const enabled = parseSettingState(state);
      const flag = enabled ? '1' : '0';
      const bool = enabled ? 'true' : 'false';
      await runCmd(
        'adb',
        adbArgs(device, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', flag]),
      );
      await runCmd(
        'adb',
        adbArgs(device, [
          'shell',
          'am',
          'broadcast',
          '-a',
          'android.intent.action.AIRPLANE_MODE',
          '--ez',
          'state',
          bool,
        ]),
      );
      return;
    }
    case 'location': {
      const enabled = parseSettingState(state);
      const mode = enabled ? '3' : '0';
      await runCmd(
        'adb',
        adbArgs(device, ['shell', 'settings', 'put', 'secure', 'location_mode', mode]),
      );
      return;
    }
    case 'appearance': {
      const target = await resolveAndroidAppearanceTarget(device, state);
      await runCmd(
        'adb',
        adbArgs(device, ['shell', 'cmd', 'uimode', 'night', target === 'dark' ? 'yes' : 'no']),
      );
      return;
    }
    case 'fingerprint': {
      const action = parseAndroidFingerprintAction(state);
      await runAndroidFingerprintCommand(device, action);
      return;
    }
    case 'permission': {
      if (!appPackage) {
        throw new AppError('INVALID_ARGS', 'permission setting requires an active app in session');
      }
      const action = parsePermissionAction(state);
      const target = parseAndroidPermissionTarget(
        options?.permissionTarget,
        options?.permissionMode,
      );
      if (target.kind === 'notifications') {
        await setAndroidNotificationPermission(device, appPackage, action, target);
        return;
      }
      const pmAction = action === 'grant' ? 'grant' : 'revoke';
      if (target.type === 'photos') {
        await setAndroidPhotoPermission(device, appPackage, pmAction);
        return;
      }
      await runCmd('adb', adbArgs(device, ['shell', 'pm', pmAction, appPackage, target.value]));
      return;
    }
    default:
      throw new AppError('INVALID_ARGS', `Unsupported setting: ${setting}`);
  }
}

type AndroidFingerprintAction = 'match' | 'nonmatch';

function parseAndroidFingerprintAction(state: string): AndroidFingerprintAction {
  const normalized = state.trim().toLowerCase();
  if (normalized === 'match') return 'match';
  if (normalized === 'nonmatch') return 'nonmatch';
  throw new AppError('INVALID_ARGS', `Invalid fingerprint state: ${state}. Use match|nonmatch.`);
}

async function runAndroidFingerprintCommand(
  device: DeviceInfo,
  action: AndroidFingerprintAction,
): Promise<void> {
  const attempts = androidFingerprintCommandAttempts(device, action);
  const failures: Array<{ args: string[]; stdout: string; stderr: string; exitCode: number }> = [];

  for (const args of attempts) {
    const result = await runCmd('adb', adbArgs(device, args), { allowFailure: true });
    if (result.exitCode === 0) return;
    failures.push({
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }

  const attemptsPayload = failures.map((failure) => ({
    args: failure.args.join(' '),
    exitCode: failure.exitCode,
    stderr: failure.stderr.slice(0, 400),
  }));
  const capabilityMissing =
    failures.length > 0 &&
    failures.every((failure) =>
      isAndroidFingerprintCapabilityMissing(failure.stdout, failure.stderr),
    );
  if (capabilityMissing) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'Android fingerprint simulation is not supported on this target/runtime.',
      {
        deviceId: device.id,
        action,
        hint: 'Use an Android emulator with biometric support, or a device/runtime that exposes cmd fingerprint.',
        attempts: attemptsPayload,
      },
    );
  }
  throw new AppError('COMMAND_FAILED', 'Failed to simulate Android fingerprint.', {
    deviceId: device.id,
    action,
    attempts: attemptsPayload,
  });
}

function androidFingerprintCommandAttempts(
  device: DeviceInfo,
  action: AndroidFingerprintAction,
): string[][] {
  const fingerprintId = action === 'match' ? '1' : '9999';
  const attempts: string[][] = [
    ['shell', 'cmd', 'fingerprint', 'touch', fingerprintId],
    ['shell', 'cmd', 'fingerprint', 'finger', fingerprintId],
  ];
  if (device.kind === 'emulator') {
    attempts.push(['emu', 'finger', 'touch', fingerprintId]);
  }
  return attempts;
}

function isAndroidFingerprintCapabilityMissing(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return (
    text.includes('unknown command') ||
    text.includes("can't find service: fingerprint") ||
    text.includes('service fingerprint was not found') ||
    text.includes('fingerprint cmd unavailable') ||
    text.includes('emu command is not supported') ||
    text.includes('emulator console is not running') ||
    (text.includes('fingerprint') && text.includes('not found'))
  );
}

function parseSettingState(state: string): boolean {
  const normalized = state.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  throw new AppError('INVALID_ARGS', `Invalid setting state: ${state}`);
}

async function resolveAndroidAppearanceTarget(
  device: DeviceInfo,
  state: string,
): Promise<'light' | 'dark'> {
  const action = parseAppearanceAction(state);
  if (action !== 'toggle') return action;

  const currentResult = await runCmd('adb', adbArgs(device, ['shell', 'cmd', 'uimode', 'night']), {
    allowFailure: true,
  });
  if (currentResult.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to read current Android appearance', {
      stdout: currentResult.stdout,
      stderr: currentResult.stderr,
      exitCode: currentResult.exitCode,
    });
  }
  const current = parseAndroidAppearance(currentResult.stdout, currentResult.stderr);
  if (!current) {
    throw new AppError(
      'COMMAND_FAILED',
      'Unable to determine current Android appearance for toggle',
      {
        stdout: currentResult.stdout,
        stderr: currentResult.stderr,
      },
    );
  }
  if (current === 'auto') return 'dark';
  return current === 'dark' ? 'light' : 'dark';
}

function parseAndroidAppearance(stdout: string, stderr: string): 'light' | 'dark' | 'auto' | null {
  const match = /night mode:\s*(yes|no|auto)\b/i.exec(`${stdout}\n${stderr}`);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (value === 'yes') return 'dark';
  if (value === 'no') return 'light';
  if (value === 'auto') return 'auto';
  return null;
}

function parseAndroidPermissionTarget(
  permissionTarget: string | undefined,
  permissionMode: string | undefined,
):
  | { kind: 'pm'; value: string; type: 'camera' | 'microphone' | 'photos' | 'contacts' }
  | { kind: 'notifications'; appOps: string; permission: string } {
  const normalized = parsePermissionTarget(permissionTarget);
  if (permissionMode?.trim()) {
    throw new AppError(
      'INVALID_ARGS',
      `Permission mode is only supported for photos. Received: ${permissionMode}.`,
    );
  }
  if (normalized === 'camera')
    return { kind: 'pm', value: 'android.permission.CAMERA', type: 'camera' };
  if (normalized === 'microphone') {
    return { kind: 'pm', value: 'android.permission.RECORD_AUDIO', type: 'microphone' };
  }
  if (normalized === 'photos') {
    return { kind: 'pm', value: 'android.permission.READ_MEDIA_IMAGES', type: 'photos' };
  }
  if (normalized === 'contacts') {
    return { kind: 'pm', value: 'android.permission.READ_CONTACTS', type: 'contacts' };
  }
  if (normalized === 'notifications') {
    return {
      kind: 'notifications',
      appOps: 'POST_NOTIFICATION',
      permission: 'android.permission.POST_NOTIFICATIONS',
    };
  }
  throw new AppError(
    'INVALID_ARGS',
    `Unsupported permission target on Android: ${permissionTarget}. Use camera|microphone|photos|contacts|notifications.`,
  );
}

async function setAndroidPhotoPermission(
  device: DeviceInfo,
  appPackage: string,
  pmAction: 'grant' | 'revoke',
): Promise<void> {
  const sdkInt = await getAndroidSdkInt(device);
  const candidates =
    sdkInt !== null && sdkInt >= 33
      ? ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_EXTERNAL_STORAGE']
      : ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.READ_MEDIA_IMAGES'];

  const failures: Array<{ permission: string; stderr: string; exitCode: number }> = [];
  for (const permission of candidates) {
    const result = await runCmd(
      'adb',
      adbArgs(device, ['shell', 'pm', pmAction, appPackage, permission]),
      { allowFailure: true },
    );
    if (result.exitCode === 0) return;
    failures.push({ permission, stderr: result.stderr, exitCode: result.exitCode });
  }

  throw new AppError('COMMAND_FAILED', `Failed to ${pmAction} Android photos permission`, {
    appPackage,
    sdkInt,
    attempts: failures,
  });
}

async function setAndroidNotificationPermission(
  device: DeviceInfo,
  appPackage: string,
  action: 'grant' | 'deny' | 'reset',
  target: { appOps: string; permission: string },
): Promise<void> {
  const appOpsMode = action === 'grant' ? 'allow' : action === 'deny' ? 'deny' : 'default';
  if (action === 'grant') {
    await runCmd('adb', adbArgs(device, ['shell', 'pm', 'grant', appPackage, target.permission]), {
      allowFailure: true,
    });
  } else {
    await runCmd('adb', adbArgs(device, ['shell', 'pm', 'revoke', appPackage, target.permission]), {
      allowFailure: true,
    });
    if (action === 'reset') {
      await runCmd(
        'adb',
        adbArgs(device, [
          'shell',
          'pm',
          'clear-permission-flags',
          appPackage,
          target.permission,
          'user-set',
        ]),
        { allowFailure: true },
      );
      await runCmd(
        'adb',
        adbArgs(device, [
          'shell',
          'pm',
          'clear-permission-flags',
          appPackage,
          target.permission,
          'user-fixed',
        ]),
        { allowFailure: true },
      );
    }
  }
  await runCmd(
    'adb',
    adbArgs(device, ['shell', 'appops', 'set', appPackage, target.appOps, appOpsMode]),
  );
}

async function getAndroidSdkInt(device: DeviceInfo): Promise<number | null> {
  const result = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'getprop', 'ro.build.version.sdk']),
    {
      allowFailure: true,
    },
  );
  if (result.exitCode !== 0) return null;
  const value = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}
