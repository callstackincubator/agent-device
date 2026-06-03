import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runHarmonyHdc } from './hdc.ts';

const UITEST_DAEMON_TOKEN = 'agent-device';

export async function listHarmonyUitestProcesses(device: DeviceInfo): Promise<string[]> {
  const result = await runHarmonyHdc(device, ['shell', 'ps', '-ef'], {
    allowFailure: true,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /uitest/i.test(line));
}

export function findStuckHarmonyUitestProcess(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (/uitest\s+uiRecord\s+record/i.test(line)) {
      return line;
    }
  }
  return null;
}

export function buildHarmonyUitestBlockedHint(stuckLine?: string): string {
  const detail = stuckLine ? ` Detected: ${stuckLine.trim()}` : '';
  return (
    'HarmonyOS uitest is blocked, so dumpLayout/snapshot cannot run.' +
    ' Reboot the device to clear stuck uitest uiRecord sessions.' +
    ' Avoid leaving `hdc shell uitest uiRecord record` running in the background.' +
    detail
  );
}

export async function ensureHarmonyUitestReady(device: DeviceInfo): Promise<void> {
  const lines = await listHarmonyUitestProcesses(device);
  const stuck = findStuckHarmonyUitestProcess(lines);
  if (stuck) {
    throw new AppError(
      'COMMAND_FAILED',
      'HarmonyOS uitest is blocked by a stuck uiRecord session',
      {
        hint: buildHarmonyUitestBlockedHint(stuck),
      },
    );
  }

  await runHarmonyHdc(device, ['shell', 'uitest', 'start-daemon', UITEST_DAEMON_TOKEN], {
    allowFailure: true,
    timeoutMs: 5_000,
  });
}
