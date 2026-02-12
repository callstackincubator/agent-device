import { runCmd } from '../../utils/exec.ts';
import type { ExecResult } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { Deadline, retryWithPolicy, TIMEOUT_PROFILES, type RetryTelemetryEvent } from '../../utils/retry.ts';
import { bootFailureHint, classifyBootFailure } from '../boot-diagnostics.ts';

const ALIASES: Record<string, string> = {
  settings: 'com.apple.Preferences',
};

const IOS_BOOT_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_BOOT_TIMEOUT_MS,
  TIMEOUT_PROFILES.ios_boot.totalMs,
  5_000,
);
const RETRY_LOGS_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  (process.env.AGENT_DEVICE_RETRY_LOGS ?? '').toLowerCase(),
);

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
    await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
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

export async function screenshotIos(device: DeviceInfo, outPath: string): Promise<void> {
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    await runCmd('xcrun', ['simctl', 'io', device.id, 'screenshot', outPath]);
    return;
  }
  await runCmd('xcrun', ['devicectl', 'device', 'screenshot', '--device', device.id, outPath]);
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

function ensureSimulator(device: DeviceInfo, command: string): void {
  if (device.kind !== 'simulator') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `${command} is only supported on iOS simulators in v1`,
    );
  }
}

function parseSettingState(state: string): boolean {
  const normalized = state.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  throw new AppError('INVALID_ARGS', `Invalid setting state: ${state}`);
}

export async function listSimulatorApps(
  device: DeviceInfo,
): Promise<{ bundleId: string; name: string }[]> {
  const result = await runCmd('xcrun', ['simctl', 'listapps', device.id], { allowFailure: true });
  const stdout = result.stdout as string;
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: Record<string, { CFBundleDisplayName?: string; CFBundleName?: string }> | null = null;
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed) as Record<
        string,
        { CFBundleDisplayName?: string; CFBundleName?: string }
      >;
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

export async function ensureBootedSimulator(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') return;
  const state = await getSimulatorState(device.id);
  if (state === 'Booted') return;
  const deadline = Deadline.fromTimeoutMs(IOS_BOOT_TIMEOUT_MS);
  let bootResult: ExecResult | undefined;
  let bootStatusResult: ExecResult | undefined;
  try {
    await retryWithPolicy(
      async () => {
        bootResult = await runCmd('xcrun', ['simctl', 'boot', device.id], { allowFailure: true });
        const bootOutput = `${bootResult.stdout}\n${bootResult.stderr}`.toLowerCase();
        const bootAlreadyDone =
          bootOutput.includes('already booted') || bootOutput.includes('current state: booted');
        if (bootResult.exitCode !== 0 && !bootAlreadyDone) {
          throw new AppError('COMMAND_FAILED', 'simctl boot failed', {
            stdout: bootResult.stdout,
            stderr: bootResult.stderr,
            exitCode: bootResult.exitCode,
          });
        }
        bootStatusResult = await runCmd('xcrun', ['simctl', 'bootstatus', device.id, '-b'], {
          allowFailure: true,
        });
        if (bootStatusResult.exitCode !== 0) {
          throw new AppError('COMMAND_FAILED', 'simctl bootstatus failed', {
            stdout: bootStatusResult.stdout,
            stderr: bootStatusResult.stderr,
            exitCode: bootStatusResult.exitCode,
          });
        }
        const nextState = await getSimulatorState(device.id);
        if (nextState !== 'Booted') {
          throw new AppError('COMMAND_FAILED', 'Simulator is still booting', {
            state: nextState,
          });
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 2000,
        jitter: 0.2,
        shouldRetry: (error) => {
          const reason = classifyBootFailure({
            error,
            stdout: bootStatusResult?.stdout ?? bootResult?.stdout,
            stderr: bootStatusResult?.stderr ?? bootResult?.stderr,
            context: { platform: 'ios', phase: 'boot' },
          });
          return reason !== 'IOS_BOOT_TIMEOUT' && reason !== 'CI_RESOURCE_STARVATION_SUSPECTED';
        },
      },
      {
        deadline,
        phase: 'boot',
        classifyReason: (error) =>
          classifyBootFailure({
            error,
            stdout: bootStatusResult?.stdout ?? bootResult?.stdout,
            stderr: bootStatusResult?.stderr ?? bootResult?.stderr,
            context: { platform: 'ios', phase: 'boot' },
          }),
        onEvent: (event: RetryTelemetryEvent) => {
          if (!RETRY_LOGS_ENABLED) return;
          process.stderr.write(`[agent-device][retry] ${JSON.stringify(event)}\n`);
        },
      },
    );
  } catch (error) {
    const bootStdout = bootResult?.stdout;
    const bootStderr = bootResult?.stderr;
    const bootExitCode = bootResult?.exitCode;
    const bootstatusStdout = bootStatusResult?.stdout;
    const bootstatusStderr = bootStatusResult?.stderr;
    const bootstatusExitCode = bootStatusResult?.exitCode;
    const reason = classifyBootFailure({
      error,
      stdout: bootstatusStdout ?? bootStdout,
      stderr: bootstatusStderr ?? bootStderr,
      context: { platform: 'ios', phase: 'boot' },
    });
    throw new AppError('COMMAND_FAILED', 'iOS simulator failed to boot', {
      platform: 'ios',
      deviceId: device.id,
      timeoutMs: IOS_BOOT_TIMEOUT_MS,
      elapsedMs: deadline.elapsedMs(),
      reason,
      hint: bootFailureHint(reason),
      boot: bootResult
        ? { exitCode: bootExitCode, stdout: bootStdout, stderr: bootStderr }
        : undefined,
      bootstatus: bootStatusResult
        ? {
          exitCode: bootstatusExitCode,
          stdout: bootstatusStdout,
          stderr: bootstatusStderr,
        }
        : undefined,
    });
  }
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

function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}
