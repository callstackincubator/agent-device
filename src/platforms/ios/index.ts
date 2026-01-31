import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const ALIASES: Record<string, string> = {
  settings: 'com.apple.Preferences',
};

export async function resolveIosApp(device: DeviceInfo, app: string): Promise<string> {
  const trimmed = app.trim();
  if (trimmed.includes('.')) return trimmed;

  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  if (device.kind === 'simulator') {
    const list = await listSimulatorApps(device);
    const matches = list.filter((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
    if (matches.length === 1) return matches[0].bundleId;
    if (matches.length > 1) {
      throw new AppError('INVALID_ARGS', `Multiple apps matched "${app}"`, { matches });
    }
  }

  throw new AppError('APP_NOT_INSTALLED', `No app found matching "${app}"`);
}

export async function openIosApp(device: DeviceInfo, app: string): Promise<void> {
  const bundleId = await resolveIosApp(device, app);
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    await runCmd('xcrun', ['simctl', 'launch', device.id, bundleId]);
    return;
  }
  await runCmd('xcrun', [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    device.id,
    bundleId,
  ]);
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
  await runCmd('xcrun', [
    'devicectl',
    'device',
    'process',
    'terminate',
    '--device',
    device.id,
    bundleId,
  ]);
}

export async function pressIos(device: DeviceInfo, x: number, y: number): Promise<void> {
  ensureSimulator(device, 'press');
  await ensureBootedSimulator(device);
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    'simctl io tap is not available; use the XCTest runner for input',
  );
}

export async function longPressIos(
  device: DeviceInfo,
  x: number,
  y: number,
  durationMs = 800,
): Promise<void> {
  ensureSimulator(device, 'long-press');
  await ensureBootedSimulator(device);
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    'long-press is not supported on iOS simulators without XCTest runner support',
  );
}

export async function focusIos(device: DeviceInfo, x: number, y: number): Promise<void> {
  await pressIos(device, x, y);
}

export async function typeIos(device: DeviceInfo, text: string): Promise<void> {
  ensureSimulator(device, 'type');
  await ensureBootedSimulator(device);
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    'simctl io keyboard is not available; use the XCTest runner for input',
  );
}

export async function fillIos(
  device: DeviceInfo,
  x: number,
  y: number,
  text: string,
): Promise<void> {
  await focusIos(device, x, y);
  await typeIos(device, text);
}

export async function scrollIos(
  device: DeviceInfo,
  direction: string,
  amount = 0.6,
): Promise<void> {
  ensureSimulator(device, 'scroll');
  await ensureBootedSimulator(device);
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    'simctl io swipe is not available; use the XCTest runner for input',
  );
}

export async function scrollIntoViewIos(text: string): Promise<void> {
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    `scrollintoview is not supported on iOS without UI automation (${text})`,
  );
}

export async function screenshotIos(device: DeviceInfo, outPath: string): Promise<void> {
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    await runCmd('xcrun', ['simctl', 'io', device.id, 'screenshot', outPath]);
    return;
  }
  await runCmd('xcrun', ['devicectl', 'device', 'screenshot', '--device', device.id, outPath]);
}

function ensureSimulator(device: DeviceInfo, command: string): void {
  if (device.kind !== 'simulator') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `${command} is only supported on iOS simulators in v1`,
    );
  }
}

async function listSimulatorApps(
  device: DeviceInfo,
): Promise<{ bundleId: string; name: string }[]> {
  const result = await runCmd('xcrun', ['simctl', 'listapps', device.id], { allowFailure: true });
  const stdout = result.stdout as string;
  if (!stdout.trim().startsWith('{')) return [];
  try {
    const payload = JSON.parse(stdout) as Record<
      string,
      { CFBundleDisplayName?: string; CFBundleName?: string }
    >;
    return Object.entries(payload).map(([bundleId, info]) => ({
      bundleId,
      name: info.CFBundleDisplayName ?? info.CFBundleName ?? bundleId,
    }));
  } catch {
    return [];
  }
}

export async function getSimulatorScreenSize(
  device: DeviceInfo,
): Promise<{ width: number; height: number }> {
  await ensureBootedSimulator(device);
  const result = await runCmd('xcrun', ['simctl', 'io', device.id, 'status-bar', '--list'], {
    allowFailure: true,
  });
  const match = (result.stdout as string).match(/(\d+)x(\d+)/);
  if (match) return { width: Number(match[1]), height: Number(match[2]) };
  return { width: 1170, height: 2532 };
}

async function ensureBootedSimulator(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') return;
  const state = await getSimulatorState(device.id);
  if (state === 'Booted') return;
  await runCmd('xcrun', ['simctl', 'boot', device.id], { allowFailure: true });
  await runCmd('xcrun', ['simctl', 'bootstatus', device.id, '-b'], { allowFailure: true });
}

async function getSimulatorState(udid: string): Promise<string | null> {
  const result = await runCmd('xcrun', ['simctl', 'list', 'devices', '-j'], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) return null;
  try {
    const payload = JSON.parse(result.stdout as string) as {
      devices: Record<string, { udid: string; state: string }[]>;
    };
    for (const runtime of Object.values(payload.devices ?? {})) {
      const match = runtime.find((d) => d.udid === udid);
      if (match) return match.state;
    }
  } catch {
    return null;
  }
  return null;
}
