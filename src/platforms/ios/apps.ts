import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { Deadline, retryWithPolicy } from '../../utils/retry.ts';
import { isDeepLinkTarget, resolveIosDeviceDeepLinkBundleId } from '../../core/open-target.ts';

import { IOS_APP_LAUNCH_TIMEOUT_MS } from './config.ts';
import { listIosDeviceApps, runIosDevicectl, type IosAppInfo } from './devicectl.ts';
import { ensureBootedSimulator, ensureSimulator, getSimulatorState } from './simulator.ts';

const ALIASES: Record<string, string> = {
  settings: 'com.apple.Preferences',
};

export async function resolveIosApp(device: DeviceInfo, app: string): Promise<string> {
  const trimmed = app.trim();
  if (trimmed.includes('.')) return trimmed;

  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  const list =
    device.kind === 'simulator'
      ? await listSimulatorApps(device)
      : await listIosDeviceApps(device, 'all');
  const matches = list.filter((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
  if (matches.length === 1) return matches[0].bundleId;
  if (matches.length > 1) {
    throw new AppError('INVALID_ARGS', `Multiple apps matched "${app}"`, { matches });
  }

  throw new AppError('APP_NOT_INSTALLED', `No app found matching "${app}"`);
}

export async function openIosApp(
  device: DeviceInfo,
  app: string,
  options?: { appBundleId?: string; url?: string },
): Promise<void> {
  const explicitUrl = options?.url?.trim();
  if (explicitUrl) {
    if (!isDeepLinkTarget(explicitUrl)) {
      throw new AppError('INVALID_ARGS', 'open <app> <url> requires a valid URL target');
    }
    if (device.kind === 'simulator') {
      await ensureBootedSimulator(device);
      await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
      await runCmd('xcrun', ['simctl', 'openurl', device.id, explicitUrl]);
      return;
    }
    const appBundleId = options?.appBundleId ?? (await resolveIosApp(device, app));
    const bundleId = resolveIosDeviceDeepLinkBundleId(appBundleId, explicitUrl);
    if (!bundleId) {
      throw new AppError(
        'INVALID_ARGS',
        'Deep link open on iOS devices requires an active app bundle ID. Open the app first, then open the URL.',
      );
    }
    await launchIosDeviceProcess(device, bundleId, { payloadUrl: explicitUrl });
    return;
  }

  const deepLinkTarget = app.trim();
  if (isDeepLinkTarget(deepLinkTarget)) {
    if (device.kind === 'simulator') {
      await ensureBootedSimulator(device);
      await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
      await runCmd('xcrun', ['simctl', 'openurl', device.id, deepLinkTarget]);
      return;
    }
    const bundleId = resolveIosDeviceDeepLinkBundleId(options?.appBundleId, deepLinkTarget);
    if (!bundleId) {
      throw new AppError(
        'INVALID_ARGS',
        'Deep link open on iOS devices requires an active app bundle ID. Open the app first, then open the URL.',
      );
    }
    await launchIosDeviceProcess(device, bundleId, { payloadUrl: deepLinkTarget });
    return;
  }

  const bundleId = options?.appBundleId ?? (await resolveIosApp(device, app));
  if (device.kind === 'simulator') {
    await launchIosSimulatorApp(device, bundleId);
    return;
  }

  await launchIosDeviceProcess(device, bundleId);
}

export async function openIosDevice(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') return;
  const state = await getSimulatorState(device.id);
  if (state === 'Booted') return;

  await ensureBootedSimulator(device);
  await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
}

export async function closeIosApp(device: DeviceInfo, app: string): Promise<void> {
  const bundleId = await resolveIosApp(device, app);
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    const result = await runCmd('xcrun', ['simctl', 'terminate', device.id, bundleId], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toLowerCase();
      if (stderr.includes('found nothing to terminate')) return;
      throw new AppError('COMMAND_FAILED', `xcrun exited with code ${result.exitCode}`, {
        cmd: 'xcrun',
        args: ['simctl', 'terminate', device.id, bundleId],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }
    return;
  }

  await runIosDevicectl(['device', 'process', 'terminate', '--device', device.id, bundleId], {
    action: 'terminate iOS app',
    deviceId: device.id,
  });
}

export async function uninstallIosApp(device: DeviceInfo, app: string): Promise<{ bundleId: string }> {
  ensureSimulator(device, 'reinstall');
  const bundleId = await resolveIosApp(device, app);
  await ensureBootedSimulator(device);

  const result = await runCmd('xcrun', ['simctl', 'uninstall', device.id, bundleId], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (!output.includes('not installed') && !output.includes('not found') && !output.includes('no such file')) {
      throw new AppError('COMMAND_FAILED', `simctl uninstall failed for ${bundleId}`, {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }
  }

  return { bundleId };
}

export async function installIosApp(device: DeviceInfo, appPath: string): Promise<void> {
  ensureSimulator(device, 'reinstall');
  await ensureBootedSimulator(device);
  await runCmd('xcrun', ['simctl', 'install', device.id, appPath]);
}

export async function reinstallIosApp(
  device: DeviceInfo,
  app: string,
  appPath: string,
): Promise<{ bundleId: string }> {
  const { bundleId } = await uninstallIosApp(device, app);
  await installIosApp(device, appPath);
  return { bundleId };
}

export async function screenshotIos(device: DeviceInfo, outPath: string): Promise<void> {
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    await runCmd('xcrun', ['simctl', 'io', device.id, 'screenshot', outPath]);
    return;
  }

  await runIosDevicectl(['device', 'screenshot', '--device', device.id, outPath], {
    action: 'capture iOS screenshot',
    deviceId: device.id,
  });
}

export async function setIosSetting(
  device: DeviceInfo,
  setting: string,
  state: string,
  appBundleId?: string,
): Promise<void> {
  ensureSimulator(device, 'settings');
  await ensureBootedSimulator(device);
  const normalized = setting.toLowerCase();
  const enabled = parseSettingState(state);

  switch (normalized) {
    case 'wifi': {
      const mode = enabled ? 'active' : 'failed';
      await runCmd('xcrun', ['simctl', 'status_bar', device.id, 'override', '--wifiMode', mode]);
      return;
    }
    case 'airplane': {
      if (enabled) {
        await runCmd('xcrun', [
          'simctl',
          'status_bar',
          device.id,
          'override',
          '--dataNetwork',
          'hide',
          '--wifiMode',
          'failed',
          '--wifiBars',
          '0',
          '--cellularMode',
          'failed',
          '--cellularBars',
          '0',
          '--operatorName',
          '',
        ]);
      } else {
        await runCmd('xcrun', ['simctl', 'status_bar', device.id, 'clear']);
      }
      return;
    }
    case 'location': {
      if (!appBundleId) {
        throw new AppError('INVALID_ARGS', 'location setting requires an active app in session');
      }
      const action = enabled ? 'grant' : 'revoke';
      await runCmd('xcrun', ['simctl', 'privacy', device.id, action, 'location', appBundleId]);
      return;
    }
    default:
      throw new AppError('INVALID_ARGS', `Unsupported setting: ${setting}`);
  }
}

export async function listIosApps(
  device: DeviceInfo,
  filter: 'user-installed' | 'all' = 'all',
): Promise<IosAppInfo[]> {
  if (device.kind === 'simulator') {
    const apps = await listSimulatorApps(device);
    return filterIosAppsByBundlePrefix(apps, filter);
  }
  return await listIosDeviceApps(device, filter);
}

export async function listSimulatorApps(device: DeviceInfo): Promise<IosAppInfo[]> {
  const result = await runCmd('xcrun', ['simctl', 'listapps', device.id], { allowFailure: true });
  const stdout = result.stdout as string;
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: Record<string, { CFBundleDisplayName?: string; CFBundleName?: string }> | null = null;
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed) as Record<string, { CFBundleDisplayName?: string; CFBundleName?: string }>;
    } catch {
      parsed = null;
    }
  }

  if (!parsed && trimmed.startsWith('{')) {
    try {
      const converted = await runCmd('plutil', ['-convert', 'json', '-o', '-', '-'], {
        allowFailure: true,
        stdin: trimmed,
      });
      if (converted.exitCode === 0 && converted.stdout.trim().startsWith('{')) {
        parsed = JSON.parse(converted.stdout) as Record<
          string,
          { CFBundleDisplayName?: string; CFBundleName?: string }
        >;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) return [];
  return Object.entries(parsed).map(([bundleId, info]) => ({
    bundleId,
    name: info.CFBundleDisplayName ?? info.CFBundleName ?? bundleId,
  }));
}

function parseSettingState(state: string): boolean {
  const normalized = state.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  throw new AppError('INVALID_ARGS', `Invalid setting state: ${state}`);
}

function isTransientSimulatorLaunchFailure(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code !== 'COMMAND_FAILED') return false;

  const details = (error.details ?? {}) as { exitCode?: number; stderr?: unknown };
  if (details.exitCode !== 4) return false;
  const stderr = String(details.stderr ?? '').toLowerCase();

  return (
    stderr.includes('fbsopenapplicationserviceerrordomain') &&
    stderr.includes('the request to open')
  );
}

async function launchIosSimulatorApp(device: DeviceInfo, bundleId: string): Promise<void> {
  await ensureBootedSimulator(device);
  await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });

  const launchDeadline = Deadline.fromTimeoutMs(IOS_APP_LAUNCH_TIMEOUT_MS);
  await retryWithPolicy(
    async ({ deadline: attemptDeadline }) => {
      if (attemptDeadline?.isExpired()) {
        throw new AppError('COMMAND_FAILED', 'App launch deadline exceeded', {
          timeoutMs: IOS_APP_LAUNCH_TIMEOUT_MS,
        });
      }

      const result = await runCmd('xcrun', ['simctl', 'launch', device.id, bundleId], {
        allowFailure: true,
      });
      if (result.exitCode === 0) return;

      throw new AppError('COMMAND_FAILED', `xcrun exited with code ${result.exitCode}`, {
        cmd: 'xcrun',
        args: ['simctl', 'launch', device.id, bundleId],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    },
    {
      maxAttempts: 30,
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
      jitter: 0.2,
      shouldRetry: isTransientSimulatorLaunchFailure,
    },
    { deadline: launchDeadline },
  );
}

async function launchIosDeviceProcess(
  device: DeviceInfo,
  bundleId: string,
  options?: { payloadUrl?: string },
): Promise<void> {
  const args = ['device', 'process', 'launch', '--device', device.id, bundleId];
  if (options?.payloadUrl) {
    args.push('--payload-url', options.payloadUrl);
  }
  await runIosDevicectl(args, { action: 'launch iOS app', deviceId: device.id });
}

function filterIosAppsByBundlePrefix(apps: IosAppInfo[], filter: 'user-installed' | 'all'): IosAppInfo[] {
  if (filter === 'user-installed') {
    return apps.filter((app) => !app.bundleId.startsWith('com.apple.'));
  }
  return apps;
}
