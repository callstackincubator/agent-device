import { test, expect, vi, beforeEach } from 'vitest';
import type { SessionState } from '../../types.ts';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return {
    ...actual,
    resolveTargetDevice: vi.fn(async () => {
      throw new Error('resolveTargetDevice should not run');
    }),
  };
});

vi.mock('../../device-ready.ts', () => ({
  ensureDeviceReady: vi.fn(async () => {}),
}));

import { resolveCommandDevice } from '../session-device-utils.ts';
import { resolveTargetDevice } from '../../../core/dispatch.ts';
import { ensureDeviceReady } from '../../device-ready.ts';

const mockResolveTargetDevice = vi.mocked(resolveTargetDevice);
const mockEnsureDeviceReady = vi.mocked(ensureDeviceReady);

const iosSimulatorSession: SessionState = {
  name: 'ios-sim',
  createdAt: Date.now(),
  device: {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    target: 'mobile',
  },
  actions: [],
};

async function withMockedPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

beforeEach(() => {
  mockResolveTargetDevice.mockClear();
  mockEnsureDeviceReady.mockClear();
});

test('resolveCommandDevice keeps iOS simulator session device on non-mac hosts', async () => {
  const device = await withMockedPlatform('linux', async () =>
    resolveCommandDevice({
      session: iosSimulatorSession,
      flags: {},
    }),
  );

  expect(mockResolveTargetDevice).not.toHaveBeenCalled();
  expect(device).toBe(iosSimulatorSession.device);
});
