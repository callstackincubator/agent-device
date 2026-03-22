import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCommandDevice } from '../session-device-utils.ts';
import type { SessionState } from '../../types.ts';

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

test('resolveCommandDevice keeps iOS simulator session device on non-mac hosts', async () => {
  let resolveCalls = 0;

  const device = await withMockedPlatform('linux', async () =>
    resolveCommandDevice({
      session: iosSimulatorSession,
      flags: {},
      ensureReadyFn: async () => {},
      resolveTargetDeviceFn: async () => {
        resolveCalls += 1;
        throw new Error('resolveTargetDevice should not run on non-mac hosts');
      },
    }),
  );

  assert.equal(resolveCalls, 0);
  assert.equal(device, iosSimulatorSession.device);
});
