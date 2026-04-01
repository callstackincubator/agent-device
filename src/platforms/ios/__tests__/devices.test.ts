import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import {
  isAppleProductType,
  isAppleTvProductType,
  isSupportedAppleDevicectlDevice,
  listAppleDevices,
  parseXctracePhysicalAppleDevices,
  resolveAppleTargetFromDevicectlDevice,
} from '../devices.ts';
import { runCmd, whichCmd } from '../../../utils/exec.ts';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn(), whichCmd: vi.fn() };
});

const mockRunCmd = vi.mocked(runCmd);
const mockWhichCmd = vi.mocked(whichCmd);

beforeEach(() => {
  mockRunCmd.mockReset();
  mockWhichCmd.mockReset();
  mockWhichCmd.mockResolvedValue(true);
});

async function withMockedPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform;
  // Some Apple discovery paths are gated on process.platform at runtime, so
  // these unit tests temporarily override it and always restore it in finally.
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

function createSimctlDevicesPayload() {
  return JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
        {
          name: 'iPhone 16',
          udid: 'sim-1',
          state: 'Booted',
          isAvailable: true,
        },
      ],
    },
  });
}

test('resolveAppleTargetFromDevicectlDevice detects tvOS from platform', () => {
  const target = resolveAppleTargetFromDevicectlDevice({
    hardwareProperties: { platform: 'tvOS' },
    deviceProperties: { name: 'Living Room' },
  });
  assert.equal(target, 'tv');
});

test('resolveAppleTargetFromDevicectlDevice detects AppleTV from product type', () => {
  const target = resolveAppleTargetFromDevicectlDevice({
    hardwareProperties: { platform: '' },
    deviceProperties: { name: 'Living Room', productType: 'AppleTV11,1' },
  });
  assert.equal(target, 'tv');
});

test('isSupportedAppleDevicectlDevice handles renamed AppleTV devices', () => {
  assert.equal(
    isSupportedAppleDevicectlDevice({
      hardwareProperties: { platform: '' },
      deviceProperties: { name: 'Living Room', productType: 'AppleTV11,1' },
    }),
    true,
  );
});

test('apple product type helpers classify iOS and tvOS product families', () => {
  assert.equal(isAppleProductType('iPhone16,2'), true);
  assert.equal(isAppleProductType('AppleTV11,1'), true);
  assert.equal(isAppleTvProductType('AppleTV11,1'), true);
  assert.equal(isAppleTvProductType('iPhone16,2'), false);
});

test('parseXctracePhysicalAppleDevices parses only physical devices from the Devices section', () => {
  const parsed = parseXctracePhysicalAppleDevices(
    [
      '== Devices ==',
      'My iPhone [00008020-001C2D2234567890]',
      'Living Room Apple TV [tv-udid-1]',
      'Studio Mac [mac-udid-1]',
      '== Devices Offline ==',
      'Unknown',
      'Offline iPhone [offline-udid]',
      '== Simulators ==',
      'iPhone 16 (18.0) (sim-1)',
    ].join('\n'),
  );

  assert.deepEqual(parsed, [
    {
      platform: 'ios',
      id: '00008020-001C2D2234567890',
      name: 'My iPhone',
      kind: 'device',
      target: 'mobile',
      booted: true,
    },
    {
      platform: 'ios',
      id: 'tv-udid-1',
      name: 'Living Room Apple TV',
      kind: 'device',
      target: 'tv',
      booted: true,
    },
  ]);
});

test('listAppleDevices supplements unsupported devicectl entries with xctrace physical devices', async () => {
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.join(' ') === 'simctl list devices -j') {
      return { stdout: createSimctlDevicesPayload(), stderr: '', exitCode: 0 };
    }

    if (args[0] === 'devicectl' && args[1] === 'list' && args[2] === 'devices') {
      const jsonPath = String(args[4]);
      await fs.writeFile(
        jsonPath,
        JSON.stringify({
          result: {
            devices: [
              {
                identifier: 'legacy-ecid',
                connectionProperties: { tunnelState: 'unavailable' },
                deviceProperties: { bootState: 'booted' },
              },
            ],
          },
        }),
        'utf8',
      );
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (args.join(' ') === 'xctrace list devices') {
      return {
        stdout: ['== Devices ==', 'My iPhone X [00008020-001C2D2234567890]'].join('\n'),
        stderr: '',
        exitCode: 0,
      };
    }

    throw new Error(`unexpected xcrun args: ${args.join(' ')}`);
  });

  const devices = await withMockedPlatform('darwin', async () => await listAppleDevices());

  assert.equal(
    devices.some((device) => device.kind === 'device' && device.id === '00008020-001C2D2234567890'),
    true,
  );
  assert.equal(
    devices.some((device) => device.id === 'host-macos-local'),
    true,
  );
  assert.equal(
    devices.some((device) => device.kind === 'simulator' && device.id === 'sim-1'),
    true,
  );
});

test('listAppleDevices prefers devicectl metadata when xctrace reports the same physical device', async () => {
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.join(' ') === 'simctl list devices -j') {
      return { stdout: createSimctlDevicesPayload(), stderr: '', exitCode: 0 };
    }

    if (args[0] === 'devicectl' && args[1] === 'list' && args[2] === 'devices') {
      const jsonPath = String(args[4]);
      await fs.writeFile(
        jsonPath,
        JSON.stringify({
          result: {
            devices: [
              {
                name: 'Primary Name',
                hardwareProperties: {
                  platform: 'iOS',
                  udid: '00008020-001C2D2234567890',
                  productType: 'iPhone16,2',
                },
              },
            ],
          },
        }),
        'utf8',
      );
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (args.join(' ') === 'xctrace list devices') {
      return {
        stdout: ['== Devices ==', 'Fallback Name [00008020-001C2D2234567890]'].join('\n'),
        stderr: '',
        exitCode: 0,
      };
    }

    throw new Error(`unexpected xcrun args: ${args.join(' ')}`);
  });

  const devices = await withMockedPlatform('darwin', async () => await listAppleDevices());
  const physicalDevices = devices.filter(
    (device) => device.kind === 'device' && device.platform === 'ios',
  );

  assert.equal(physicalDevices.length, 1);
  assert.equal(physicalDevices[0]?.name, 'Primary Name');
});

test('listAppleDevices keeps physical discovery disabled for simulator-set scoped runs', async () => {
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('simctl') && args.includes('list') && args.includes('devices')) {
      return { stdout: createSimctlDevicesPayload(), stderr: '', exitCode: 0 };
    }

    throw new Error(`unexpected xcrun args: ${args.join(' ')}`);
  });

  const devices = await withMockedPlatform(
    'darwin',
    async () => await listAppleDevices({ simulatorSetPath: '/tmp/agent-device-sim-set' }),
  );

  assert.equal(
    devices.some((device) => device.id === 'host-macos-local'),
    true,
  );
  assert.equal(
    devices.some((device) => device.kind === 'device' && device.platform === 'ios'),
    false,
  );
  assert.equal(
    mockRunCmd.mock.calls.some(
      ([, args]) => args.includes('devicectl') || args.includes('xctrace'),
    ),
    false,
  );
});
