import type { DeviceInfo } from '../utils/device.ts';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runCmd } from '../utils/exec.ts';
import { AppError } from '../utils/errors.ts';
import { resolveTimeoutMs } from '../utils/timeouts.ts';
import { resolveIosDevicectlHint, IOS_DEVICECTL_DEFAULT_HINT } from '../platforms/ios/devicectl.ts';

const IOS_DEVICE_READY_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_DEVICE_READY_TIMEOUT_MS,
  15_000,
  1_000,
);
const IOS_DEVICE_READY_COMMAND_TIMEOUT_BUFFER_MS = 3_000;

export async function ensureDeviceReady(device: DeviceInfo): Promise<void> {
  if (device.platform === 'ios') {
    if (device.kind === 'simulator') {
      const { ensureBootedSimulator } = await import('../platforms/ios/index.ts');
      await ensureBootedSimulator(device);
      return;
    }
    if (device.kind === 'device') {
      await ensureIosDeviceReady(device.id);
      return;
    }
  }
  if (device.platform === 'android') {
    const { waitForAndroidBoot } = await import('../platforms/android/devices.ts');
    await waitForAndroidBoot(device.id);
  }
}

async function ensureIosDeviceReady(deviceId: string): Promise<void> {
  const jsonPath = path.join(
    os.tmpdir(),
    `agent-device-ready-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const timeoutSeconds = Math.max(1, Math.ceil(IOS_DEVICE_READY_TIMEOUT_MS / 1000));
  try {
    const result = await runCmd(
      'xcrun',
      [
        'devicectl',
        'device',
        'info',
        'details',
        '--device',
        deviceId,
        '--json-output',
        jsonPath,
        '--timeout',
        String(timeoutSeconds),
      ],
      {
        allowFailure: true,
        timeoutMs: IOS_DEVICE_READY_TIMEOUT_MS + IOS_DEVICE_READY_COMMAND_TIMEOUT_BUFFER_MS,
      },
    );
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    const parsed = await readIosReadyPayload(jsonPath);
    if (result.exitCode === 0) {
      if (!parsed.parsed) {
        throw new AppError('COMMAND_FAILED', 'iOS device readiness probe failed', {
          kind: 'probe_inconclusive',
          deviceId,
          stdout,
          stderr,
          hint: 'CoreDevice returned success but readiness JSON output was missing or invalid. Retry; if it persists restart Xcode and the iOS device.',
        });
      }
      const tunnelState = parsed?.tunnelState?.toLowerCase();
      if (tunnelState === 'connecting') {
        throw new AppError('COMMAND_FAILED', 'iOS device is not ready for automation', {
          kind: 'not_ready',
          deviceId,
          tunnelState,
          hint: 'Device tunnel is still connecting. Keep the device unlocked and connected by cable until it is fully available in Xcode Devices, then retry.',
        });
      }
      return;
    }
    throw new AppError('COMMAND_FAILED', 'iOS device is not ready for automation', {
      kind: 'not_ready',
      deviceId,
      stdout,
      stderr,
      exitCode: result.exitCode,
      tunnelState: parsed?.tunnelState,
      hint: resolveIosReadyHint(stdout, stderr),
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'COMMAND_FAILED') {
      const kind = typeof error.details?.kind === 'string' ? error.details.kind : '';
      if (kind === 'not_ready') {
        throw error;
      }
      const details = (error.details ?? {}) as {
        stdout?: string;
        stderr?: string;
        timeoutMs?: number;
      };
      const stdout = String(details.stdout ?? '');
      const stderr = String(details.stderr ?? '');
      const timeoutMs = Number(details.timeoutMs ?? IOS_DEVICE_READY_TIMEOUT_MS);
      const timeoutHint = `CoreDevice did not respond within ${timeoutMs}ms. Keep the device unlocked and trusted, then retry; if it persists restart Xcode and the iOS device.`;
      throw new AppError('COMMAND_FAILED', 'iOS device readiness probe failed', {
        deviceId,
        cause: error.message,
        timeoutMs,
        stdout,
        stderr,
        hint: stdout || stderr ? resolveIosReadyHint(stdout, stderr) : timeoutHint,
      }, error);
    }
    throw new AppError('COMMAND_FAILED', 'iOS device readiness probe failed', {
      deviceId,
      hint: 'Reconnect the device, keep it unlocked, and retry.',
    }, error instanceof Error ? error : undefined);
  } finally {
    await fs.rm(jsonPath, { force: true }).catch(() => {});
  }
}

export function parseIosReadyPayload(payload: unknown): { tunnelState?: string } {
  const result = (payload as { result?: unknown } | null | undefined)?.result;
  if (!result || typeof result !== 'object') return {};
  const direct = (result as { connectionProperties?: { tunnelState?: unknown } }).connectionProperties?.tunnelState;
  const nested = (result as { device?: { connectionProperties?: { tunnelState?: unknown } } }).device?.connectionProperties?.tunnelState;
  const tunnelState = typeof direct === 'string' ? direct : typeof nested === 'string' ? nested : undefined;
  return tunnelState ? { tunnelState } : {};
}

async function readIosReadyPayload(jsonPath: string): Promise<{ parsed: boolean; tunnelState?: string }> {
  try {
    const payloadText = await fs.readFile(jsonPath, 'utf8');
    const payload = JSON.parse(payloadText) as unknown;
    const parsed = parseIosReadyPayload(payload);
    return { parsed: true, tunnelState: parsed.tunnelState };
  } catch {
    return { parsed: false };
  }
}

export function resolveIosReadyHint(stdout: string, stderr: string): string {
  const devicectlHint = resolveIosDevicectlHint(stdout, stderr);
  if (devicectlHint) return devicectlHint;
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (text.includes('timed out waiting for all destinations')) {
    return 'Xcode destination did not become available in time. Keep device unlocked and retry.';
  }
  return IOS_DEVICECTL_DEFAULT_HINT;
}
