import test from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedRefSnapshotFlags } from '../interaction.ts';

test('unsupportedRefSnapshotFlags returns unsupported snapshot flags for @ref flows', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    snapshotDepth: 2,
    snapshotScope: 'Login',
    snapshotRaw: true,
    snapshotBackend: 'ax',
  });
  assert.deepEqual(unsupported, ['--depth', '--scope', '--raw', '--backend']);
});

test('unsupportedRefSnapshotFlags returns empty when no ref-unsupported flags are present', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    platform: 'ios',
    session: 'default',
    verbose: true,
  });
  assert.deepEqual(unsupported, []);
});
