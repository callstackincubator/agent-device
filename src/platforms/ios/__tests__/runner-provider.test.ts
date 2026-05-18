import assert from 'node:assert/strict';
import { test } from 'vitest';
import { IOS_SIMULATOR } from '../../../__tests__/test-utils/index.ts';
import {
  hasScopedAppleRunnerProvider,
  resolveAppleRunnerProvider,
  withAppleRunnerProvider,
  type AppleRunnerProvider,
} from '../runner-provider.ts';

test('scoped Apple runner provider requires matching request id when scoped by request', async () => {
  const calls: string[] = [];
  const scoped = runnerProvider('scoped', calls);
  const fallback = runnerProvider('fallback', calls);

  const matched = await withAppleRunnerProvider(
    scoped,
    { deviceId: IOS_SIMULATOR.id, requestId: 'req-1' },
    async () =>
      await resolveAppleRunnerProvider(IOS_SIMULATOR, fallback, undefined, {
        requestId: 'req-1',
      }).runCommand(IOS_SIMULATOR, { command: 'snapshot' }, { requestId: 'req-1' }),
  );
  assert.equal(matched.source, 'scoped');

  const missingRequestId = await withAppleRunnerProvider(
    scoped,
    { deviceId: IOS_SIMULATOR.id, requestId: 'req-1' },
    async () =>
      await resolveAppleRunnerProvider(IOS_SIMULATOR, fallback).runCommand(
        IOS_SIMULATOR,
        { command: 'snapshot' },
        {},
      ),
  );
  assert.equal(missingRequestId.source, 'fallback');

  const differentRequestId = await withAppleRunnerProvider(
    scoped,
    { deviceId: IOS_SIMULATOR.id, requestId: 'req-1' },
    async () =>
      await resolveAppleRunnerProvider(IOS_SIMULATOR, fallback, undefined, {
        requestId: 'req-2',
      }).runCommand(IOS_SIMULATOR, { command: 'snapshot' }, { requestId: 'req-2' }),
  );
  assert.equal(differentRequestId.source, 'fallback');
  assert.deepEqual(calls, ['scoped', 'fallback', 'fallback']);
});

test('scoped Apple runner provider detection follows request scoping', async () => {
  const scoped = runnerProvider('scoped', []);

  await withAppleRunnerProvider(
    scoped,
    { deviceId: IOS_SIMULATOR.id, requestId: 'req-1' },
    async () => {
      assert.equal(hasScopedAppleRunnerProvider(IOS_SIMULATOR, { requestId: 'req-1' }), true);
      assert.equal(hasScopedAppleRunnerProvider(IOS_SIMULATOR), false);
      assert.equal(hasScopedAppleRunnerProvider(IOS_SIMULATOR, { requestId: 'req-2' }), false);
      assert.equal(
        hasScopedAppleRunnerProvider({ ...IOS_SIMULATOR, id: 'other-sim' }, { requestId: 'req-1' }),
        false,
      );
    },
  );
});

function runnerProvider(source: string, calls: string[]): AppleRunnerProvider {
  return {
    runCommand: async () => {
      calls.push(source);
      return { source };
    },
  };
}
