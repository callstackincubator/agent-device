import type { DeviceInfo } from '../../utils/device.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';

type RestorableStatusBarOverrides = Partial<
  Record<
    'dataNetwork' | 'wifiMode' | 'wifiBars' | 'cellularMode' | 'cellularBars' | 'operatorName',
    string
  >
>;

const DETERMINISTIC_SCREENSHOT_STATUS_BAR_ARGS = [
  '--time',
  '9:41',
  '--dataNetwork',
  'wifi',
  '--wifiMode',
  'active',
  '--wifiBars',
  '3',
  '--batteryState',
  'charged',
  '--batteryLevel',
  '100',
];

const DATA_NETWORK_TYPE_BY_CODE: Record<number, string> = {
  0: 'hide',
  1: 'wifi',
  6: '3g',
  7: '4g',
  8: 'lte',
  9: 'lte-a',
  10: 'lte+',
  11: '5g',
  12: '5g+',
  13: '5g-uwb',
  14: '5g-uc',
};

const WIFI_MODE_BY_CODE: Partial<Record<number, string>> = {
  1: 'searching',
  2: 'failed',
  3: 'active',
};

const CELLULAR_MODE_BY_CODE: Record<number, string> = {
  0: 'notSupported',
  1: 'searching',
  2: 'failed',
  3: 'active',
};

function simctlArgs(device: DeviceInfo, args: string[]): string[] {
  return buildSimctlArgsForDevice(device, args);
}

function runSimctl(device: DeviceInfo, args: string[], options?: Parameters<typeof runCmd>[2]) {
  return runCmd('xcrun', simctlArgs(device, args), options);
}

export async function prepareSimulatorStatusBarForScreenshot(
  device: DeviceInfo,
): Promise<() => Promise<void>> {
  let previousOverrides: RestorableStatusBarOverrides | null = null;
  let canRestorePreviousOverrides = false;
  try {
    previousOverrides = await readSimulatorStatusBarOverrides(device);
    canRestorePreviousOverrides = true;
  } catch (error) {
    emitStatusBarDiagnostic(device, 'snapshot_failed', error);
  }

  try {
    await clearSimulatorStatusBarOverride(device);
    await applySimulatorStatusBarOverrideArgs(device, DETERMINISTIC_SCREENSHOT_STATUS_BAR_ARGS);
  } catch (error) {
    emitStatusBarDiagnostic(device, 'prepare_failed', error);
  }

  return async () => {
    await restoreSimulatorStatusBarOverrides(
      device,
      canRestorePreviousOverrides ? previousOverrides : null,
    );
  };
}

async function restoreSimulatorStatusBarOverrides(
  device: DeviceInfo,
  overrides: RestorableStatusBarOverrides | null,
): Promise<void> {
  await clearSimulatorStatusBarOverride(device);
  if (!overrides) return;
  await applySimulatorStatusBarOverrideArgs(
    device,
    buildRestorableStatusBarOverrideArgs(overrides),
  );
}

async function readSimulatorStatusBarOverrides(
  device: DeviceInfo,
): Promise<RestorableStatusBarOverrides | null> {
  const result = await runSimctl(device, ['status_bar', device.id, 'list'], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to read simulator status bar overrides', {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return parseSimulatorStatusBarOverrides(result.stdout);
}

async function clearSimulatorStatusBarOverride(device: DeviceInfo): Promise<void> {
  await runSimctl(device, ['status_bar', device.id, 'clear']);
}

async function applySimulatorStatusBarOverrideArgs(
  device: DeviceInfo,
  args: string[],
): Promise<void> {
  if (args.length === 0) return;
  await runSimctl(device, ['status_bar', device.id, 'override', ...args]);
}

function parseSimulatorStatusBarOverrides(output: string): RestorableStatusBarOverrides | null {
  const overrides: RestorableStatusBarOverrides = {};
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && line !== 'Current Status Bar Overrides:' && !/^=+$/.test(line),
    );

  for (const line of lines) {
    const dataNetworkMatch = /^DataNetworkType:\s+(\d+)$/.exec(line);
    if (dataNetworkMatch) {
      const code = Number(dataNetworkMatch[1]);
      const value = DATA_NETWORK_TYPE_BY_CODE[code];
      if (!value) {
        throw new AppError('COMMAND_FAILED', `Unsupported simulator data network type: ${code}`);
      }
      overrides.dataNetwork = value;
      continue;
    }

    const wifiMatch = /^WiFi Mode:\s+(\d+),\s+WiFi Bars:\s+(\d+)$/.exec(line);
    if (wifiMatch) {
      const mode = WIFI_MODE_BY_CODE[Number(wifiMatch[1])];
      if (mode) {
        overrides.wifiMode = mode;
      }
      overrides.wifiBars = wifiMatch[2];
      continue;
    }

    const cellMatch = /^Cell Mode:\s+(\d+),\s+Cell Bars:\s+(\d+)$/.exec(line);
    if (cellMatch) {
      const code = Number(cellMatch[1]);
      const mode = CELLULAR_MODE_BY_CODE[code];
      if (!mode) {
        throw new AppError('COMMAND_FAILED', `Unsupported simulator cellular mode: ${code}`);
      }
      overrides.cellularMode = mode;
      overrides.cellularBars = cellMatch[2];
      continue;
    }

    const operatorNameMatch = /^Operator Name:\s*(.*)$/.exec(line);
    if (operatorNameMatch) {
      overrides.operatorName = operatorNameMatch[1] ?? '';
      continue;
    }
  }

  return Object.keys(overrides).length === 0 ? null : overrides;
}

function buildRestorableStatusBarOverrideArgs(overrides: RestorableStatusBarOverrides): string[] {
  const args: string[] = [];
  if (overrides.dataNetwork) {
    args.push('--dataNetwork', overrides.dataNetwork);
  }
  if (overrides.wifiMode) {
    args.push('--wifiMode', overrides.wifiMode);
  }
  if (
    overrides.wifiBars !== undefined &&
    (overrides.dataNetwork === 'wifi' || overrides.wifiMode)
  ) {
    args.push('--wifiBars', overrides.wifiBars);
  }
  if (overrides.cellularMode) {
    args.push('--cellularMode', overrides.cellularMode);
  }
  if (
    overrides.cellularBars !== undefined &&
    (overrides.cellularMode ||
      isCellularDataNetworkType(overrides.dataNetwork) ||
      overrides.operatorName !== undefined)
  ) {
    args.push('--cellularBars', overrides.cellularBars);
  }
  if (overrides.operatorName !== undefined) {
    args.push('--operatorName', overrides.operatorName);
  }
  return args;
}

function isCellularDataNetworkType(value: string | undefined): boolean {
  return Boolean(value && value !== 'hide' && value !== 'wifi');
}

function emitStatusBarDiagnostic(
  device: DeviceInfo,
  phase: 'snapshot_failed' | 'prepare_failed' | 'restore_failed',
  error: unknown,
): void {
  emitDiagnostic({
    level: 'warn',
    phase: `ios_screenshot_status_bar_${phase}`,
    data: {
      platform: device.platform,
      deviceKind: device.kind,
      deviceId: device.id,
      ...extractStatusBarErrorMeta(error),
    },
  });
}

function extractStatusBarErrorMeta(error: unknown): Record<string, unknown> {
  if (!(error instanceof AppError)) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  const details = (error.details ?? {}) as {
    args?: unknown;
    exitCode?: unknown;
    stderr?: unknown;
    stdout?: unknown;
    timeoutMs?: unknown;
  };
  const args = Array.isArray(details.args)
    ? details.args.filter((value): value is string => typeof value === 'string').join(' ')
    : undefined;

  return {
    errorCode: error.code,
    reason: error.message,
    timeoutMs: typeof details.timeoutMs === 'number' ? details.timeoutMs : undefined,
    exitCode: typeof details.exitCode === 'number' ? details.exitCode : undefined,
    stderr:
      typeof details.stderr === 'string' && details.stderr.trim() ? details.stderr : undefined,
    stdout:
      typeof details.stdout === 'string' && details.stdout.trim() ? details.stdout : undefined,
    commandArgs: args,
  };
}
