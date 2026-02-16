import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';

import { IOS_DEVICECTL_TIMEOUT_MS } from './config.ts';

export type IosAppInfo = {
  bundleId: string;
  name: string;
};

type IosDeviceAppsPayload = {
  result?: {
    apps?: Array<{
      bundleIdentifier?: unknown;
      name?: unknown;
    }>;
  };
};

export async function runIosDevicectl(
  args: string[],
  context: { action: string; deviceId: string },
): Promise<void> {
  const fullArgs = ['devicectl', ...args];
  const result = await runCmd('xcrun', fullArgs, {
    allowFailure: true,
    timeoutMs: IOS_DEVICECTL_TIMEOUT_MS,
  });
  if (result.exitCode === 0) return;
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  throw new AppError('COMMAND_FAILED', `Failed to ${context.action}`, {
    cmd: 'xcrun',
    args: fullArgs,
    exitCode: result.exitCode,
    stdout,
    stderr,
    deviceId: context.deviceId,
    hint: resolveIosDevicectlHint(stdout, stderr),
  });
}

export async function listIosDeviceApps(
  device: DeviceInfo,
  filter: 'user-installed' | 'all',
): Promise<IosAppInfo[]> {
  const jsonPath = path.join(
    os.tmpdir(),
    `agent-device-ios-apps-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const args = [
    'devicectl',
    'device',
    'info',
    'apps',
    '--device',
    device.id,
    '--include-all-apps',
    '--json-output',
    jsonPath,
  ];
  const result = await runCmd('xcrun', args, {
    allowFailure: true,
    timeoutMs: IOS_DEVICECTL_TIMEOUT_MS,
  });

  try {
    if (result.exitCode !== 0) {
      const stdout = String(result.stdout ?? '');
      const stderr = String(result.stderr ?? '');
      throw new AppError('COMMAND_FAILED', 'Failed to list iOS apps', {
        cmd: 'xcrun',
        args,
        exitCode: result.exitCode,
        stdout,
        stderr,
        deviceId: device.id,
        hint: resolveIosDevicectlHint(stdout, stderr),
      });
    }
    const jsonText = await fs.readFile(jsonPath, 'utf8');
    const apps = parseIosDeviceAppsPayload(JSON.parse(jsonText));
    return filterIosDeviceApps(apps, filter);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('COMMAND_FAILED', 'Failed to parse iOS apps list', {
      deviceId: device.id,
      cause: String(error),
    });
  } finally {
    await fs.unlink(jsonPath).catch(() => {});
  }
}

export function parseIosDeviceAppsPayload(payload: unknown): IosAppInfo[] {
  const apps = (payload as IosDeviceAppsPayload | null | undefined)?.result?.apps;
  if (!Array.isArray(apps)) return [];

  const parsed: IosAppInfo[] = [];
  for (const entry of apps) {
    if (!entry || typeof entry !== 'object') continue;
    const bundleId = typeof entry.bundleIdentifier === 'string' ? entry.bundleIdentifier.trim() : '';
    if (!bundleId) continue;
    const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : bundleId;
    parsed.push({ bundleId, name });
  }
  return parsed;
}

function filterIosDeviceApps(apps: IosAppInfo[], filter: 'user-installed' | 'all'): IosAppInfo[] {
  if (filter === 'user-installed') {
    return apps.filter((app) => !app.bundleId.startsWith('com.apple.'));
  }
  return apps;
}

function resolveIosDevicectlHint(stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (text.includes('device is busy') && text.includes('connecting')) {
    return 'iOS device is still connecting. Keep it unlocked and connected by cable until it is fully available in Xcode Devices, then retry.';
  }
  if (text.includes('coredeviceservice') && text.includes('timed out')) {
    return 'CoreDevice service timed out. Reconnect the device and retry; if it persists restart Xcode and the iOS device.';
  }
  return 'Ensure the iOS device is unlocked, trusted, and available in Xcode > Devices, then retry.';
}
