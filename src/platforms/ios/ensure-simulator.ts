import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { buildSimctlArgs } from './simctl.ts';
import { IOS_SIMCTL_LIST_TIMEOUT_MS } from './config.ts';

type SimctlDeviceRecord = {
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
};

type SimctlListPayload = {
  devices: Record<string, SimctlDeviceRecord[]>;
};

export type EnsureSimulatorResult = {
  udid: string;
  device: string;
  runtime: string;
  created: boolean;
  booted: boolean;
};

type EnsureSimulatorOptions = {
  deviceName: string;
  runtime?: string;
  simulatorSetPath?: string | null;
  reuseExisting: boolean;
  boot: boolean;
  ensureReady: (device: DeviceInfo) => Promise<void>;
};

export async function ensureSimulatorExists(
  options: EnsureSimulatorOptions,
): Promise<EnsureSimulatorResult> {
  const { deviceName, runtime, simulatorSetPath, reuseExisting, boot, ensureReady } = options;

  if (process.platform !== 'darwin') {
    throw new AppError('UNSUPPORTED_PLATFORM', 'ensure-simulator is only available on macOS');
  }

  const simctlOpts = { simulatorSetPath: simulatorSetPath ?? undefined };
  let udid: string;
  let resolvedRuntime: string;
  let created: boolean;

  if (reuseExisting) {
    const existing = await findExistingSimulator({ deviceName, runtime, simctlOpts });
    if (existing) {
      udid = existing.udid;
      resolvedRuntime = existing.runtime;
      created = false;
    } else {
      const result = await createSimulator({ deviceName, runtime, simctlOpts });
      udid = result.udid;
      resolvedRuntime = await resolveSimulatorRuntime(udid, simctlOpts);
      created = true;
    }
  } else {
    const result = await createSimulator({ deviceName, runtime, simctlOpts });
    udid = result.udid;
    resolvedRuntime = await resolveSimulatorRuntime(udid, simctlOpts);
    created = true;
  }

  let booted = false;
  if (boot) {
    const device: DeviceInfo = {
      platform: 'ios',
      id: udid,
      name: deviceName,
      kind: 'simulator',
      target: 'mobile',
      ...(simulatorSetPath ? { simulatorSetPath } : {}),
    };
    await ensureReady(device);
    booted = true;
  }

  return { udid, device: deviceName, runtime: resolvedRuntime, created, booted };
}

type FindOptions = {
  deviceName: string;
  runtime?: string;
  simctlOpts: { simulatorSetPath?: string };
};

async function findExistingSimulator(
  options: FindOptions,
): Promise<{ udid: string; runtime: string } | null> {
  const { deviceName, runtime, simctlOpts } = options;
  const result = await runCmd('xcrun', buildSimctlArgs(['list', 'devices', '-j'], simctlOpts), {
    allowFailure: true,
    timeoutMs: IOS_SIMCTL_LIST_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return null;

  try {
    const payload = JSON.parse(String(result.stdout ?? '')) as SimctlListPayload;
    for (const [runtimeKey, devices] of Object.entries(payload.devices ?? {})) {
      if (runtime && !normalizeRuntime(runtimeKey).includes(normalizeRuntime(runtime))) continue;
      for (const device of devices) {
        if (!device.isAvailable) continue;
        if (device.name.toLowerCase() === deviceName.toLowerCase()) {
          return { udid: device.udid, runtime: runtimeKey };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

type CreateOptions = {
  deviceName: string;
  runtime?: string;
  simctlOpts: { simulatorSetPath?: string };
};

async function createSimulator(options: CreateOptions): Promise<{ udid: string }> {
  const { deviceName, runtime, simctlOpts } = options;
  const createArgs = runtime
    ? ['create', deviceName, deviceName, runtime]
    : ['create', deviceName, deviceName];

  const result = await runCmd('xcrun', buildSimctlArgs(createArgs, simctlOpts), {
    allowFailure: true,
  });

  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to create iOS simulator', {
      deviceName,
      runtime,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      exitCode: result.exitCode,
      hint: 'Ensure the device type and runtime identifiers are valid. Run `xcrun simctl list devicetypes` and `xcrun simctl list runtimes` to see available options.',
    });
  }

  const udid = String(result.stdout ?? '').trim();
  if (!udid) {
    throw new AppError('COMMAND_FAILED', 'simctl create returned no UDID', {
      deviceName,
      runtime,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    });
  }
  return { udid };
}

async function resolveSimulatorRuntime(
  udid: string,
  simctlOpts: { simulatorSetPath?: string },
): Promise<string> {
  const result = await runCmd('xcrun', buildSimctlArgs(['list', 'devices', '-j'], simctlOpts), {
    allowFailure: true,
    timeoutMs: IOS_SIMCTL_LIST_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return '';
  try {
    const payload = JSON.parse(String(result.stdout ?? '')) as SimctlListPayload;
    for (const [runtimeKey, devices] of Object.entries(payload.devices ?? {})) {
      if (devices.some((d) => d.udid === udid)) return runtimeKey;
    }
    return '';
  } catch {
    return '';
  }
}

function normalizeRuntime(runtime: string): string {
  return runtime.toLowerCase().replace(/[._-]/g, '');
}
