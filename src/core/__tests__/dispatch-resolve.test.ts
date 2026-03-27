import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../../platforms/ios/devices.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/devices.ts')>();
  return { ...actual, findBootableIosSimulator: vi.fn() };
});

import { resolveIosDevice } from '../dispatch-resolve.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { findBootableIosSimulator } from '../../platforms/ios/devices.ts';

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

const mockFindBootableIosSimulator = vi.mocked(findBootableIosSimulator);

beforeEach(() => {
  mockFindBootableIosSimulator.mockReset();
  mockFindBootableIosSimulator.mockResolvedValue(null);
});

// --- Physical device rejected in favour of simulator fallback ---

test('resolveIosDevice prefers fallback simulator over auto-selected physical device', async () => {
  mockFindBootableIosSimulator.mockResolvedValue(simulator);
  const result = await resolveIosDevice([physical], { platform: 'ios' }, {});
  assert.equal(result.id, 'sim-1');
  assert.equal(result.kind, 'simulator');
});

test('resolveIosDevice falls back to physical device when no simulator is found', async () => {
  const result = await resolveIosDevice([physical], { platform: 'ios' }, {});
  assert.equal(result.id, 'phys-1');
  assert.equal(result.kind, 'device');
});

// --- Explicit selectors bypass the fallback ---

test('resolveIosDevice keeps physical device when udid is explicit', async () => {
  mockFindBootableIosSimulator.mockResolvedValue(simulator);
  const result = await resolveIosDevice([physical], { platform: 'ios', udid: 'phys-1' }, {});
  assert.equal(result.id, 'phys-1');
  assert.equal(mockFindBootableIosSimulator.mock.calls.length, 0);
});

test('resolveIosDevice keeps physical device when deviceName is explicit', async () => {
  mockFindBootableIosSimulator.mockResolvedValue(simulator);
  const result = await resolveIosDevice(
    [physical],
    { platform: 'ios', deviceName: 'My iPhone' },
    {},
  );
  assert.equal(result.id, 'phys-1');
  assert.equal(mockFindBootableIosSimulator.mock.calls.length, 0);
});

// --- Empty device list triggers fallback (P1-A: DEVICE_NOT_FOUND recovery) ---

test('resolveIosDevice recovers from empty device list via simulator fallback', async () => {
  mockFindBootableIosSimulator.mockResolvedValue(simulator);
  const result = await resolveIosDevice([], { platform: 'ios' }, {});
  assert.equal(result.id, 'sim-1');
  assert.equal(result.kind, 'simulator');
});

test('resolveIosDevice throws DEVICE_NOT_FOUND when empty list and no fallback simulator', async () => {
  const err = await resolveIosDevice([], { platform: 'ios' }, {}).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
});

test('resolveIosDevice rethrows DEVICE_NOT_FOUND from resolveDevice when explicit selector used', async () => {
  mockFindBootableIosSimulator.mockResolvedValue(simulator);
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
  assert.equal(mockFindBootableIosSimulator.mock.calls.length, 0);
});
