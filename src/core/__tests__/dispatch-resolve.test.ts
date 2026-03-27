import { test, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { resolveIosDevice } from '../dispatch-resolve.ts';
import { type DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';

vi.mock('../../platforms/ios/devices.ts', () => ({
  findBootableIosSimulator: vi.fn(async () => null),
  listAppleDevices: vi.fn(async () => []),
}));

const { findBootableIosSimulator } = await import('../../platforms/ios/devices.ts');
const mockedFindBootable = vi.mocked(findBootableIosSimulator);

beforeEach(() => {
  vi.clearAllMocks();
});

const physical: DeviceInfo = {
  platform: 'ios',
  id: 'phys-1',
  name: 'My iPhone',
  kind: 'device',
  target: 'mobile',
  booted: true,
};

const simulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone 16',
  kind: 'simulator',
  target: 'mobile',
  booted: false,
};

const bootedSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-2',
  name: 'iPhone 15',
  kind: 'simulator',
  target: 'mobile',
  booted: true,
};

// --- Physical device rejected in favour of simulator fallback ---

test('resolveIosDevice prefers fallback simulator over auto-selected physical device', async () => {
  mockedFindBootable.mockResolvedValueOnce(simulator);
  const result = await resolveIosDevice([physical], { platform: 'ios' }, {});
  assert.equal(result.id, 'sim-1');
  assert.equal(result.kind, 'simulator');
});

test('resolveIosDevice falls back to physical device when no simulator is found', async () => {
  mockedFindBootable.mockResolvedValueOnce(null);
  const result = await resolveIosDevice([physical], { platform: 'ios' }, {});
  assert.equal(result.id, 'phys-1');
  assert.equal(result.kind, 'device');
});

// --- Explicit selectors bypass the fallback ---

test('resolveIosDevice keeps physical device when udid is explicit', async () => {
  const result = await resolveIosDevice([physical], { platform: 'ios', udid: 'phys-1' }, {});
  assert.equal(result.id, 'phys-1');
  assert.equal(mockedFindBootable.mock.calls.length, 0);
});

test('resolveIosDevice keeps physical device when deviceName is explicit', async () => {
  const result = await resolveIosDevice(
    [physical],
    { platform: 'ios', deviceName: 'My iPhone' },
    {},
  );
  assert.equal(result.id, 'phys-1');
  assert.equal(mockedFindBootable.mock.calls.length, 0);
});

// --- Empty device list triggers fallback (P1-A: DEVICE_NOT_FOUND recovery) ---

test('resolveIosDevice recovers from empty device list via simulator fallback', async () => {
  mockedFindBootable.mockResolvedValueOnce(simulator);
  const result = await resolveIosDevice([], { platform: 'ios' }, {});
  assert.equal(result.id, 'sim-1');
  assert.equal(result.kind, 'simulator');
});

test('resolveIosDevice throws DEVICE_NOT_FOUND when empty list and no fallback simulator', async () => {
  mockedFindBootable.mockResolvedValueOnce(null);
  const err = await resolveIosDevice([], { platform: 'ios' }, {}).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
});

test('resolveIosDevice rethrows DEVICE_NOT_FOUND from resolveDevice when explicit selector used', async () => {
  const err = await resolveIosDevice([], { platform: 'ios', udid: 'nonexistent' }, {}).catch(
    (e) => e,
  );
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
});

// --- Simulator already in the device list (normal path) ---

test('resolveIosDevice returns simulator directly when present in device list', async () => {
  const result = await resolveIosDevice([physical, bootedSimulator], { platform: 'ios' }, {});
  assert.equal(result.id, 'sim-2');
  assert.equal(result.kind, 'simulator');
  assert.equal(mockedFindBootable.mock.calls.length, 0);
});
