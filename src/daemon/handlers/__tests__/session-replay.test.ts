import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { buildNestedReplayFlags } from '../session-replay.ts';
import { collectReplayActionArtifactPaths } from '../session-replay-runtime.ts';

test('buildNestedReplayFlags returns parent flags untouched when neither override is set', () => {
  const parent = { platform: 'android' as const, timeoutMs: 5000 };
  const result = buildNestedReplayFlags({
    parentFlags: parent,
    platform: undefined,
    target: undefined,
    artifactsDir: undefined,
  });
  assert.strictEqual(result, parent);
});

test('buildNestedReplayFlags merges platform, target, and artifactsDir into parent flags', () => {
  const parent = { timeoutMs: 5000, retries: 1 };
  const result = buildNestedReplayFlags({
    parentFlags: parent,
    platform: 'ios',
    target: 'mobile',
    artifactsDir: '/tmp/attempt-1',
  });
  assert.deepEqual(result, {
    timeoutMs: 5000,
    retries: 1,
    platform: 'ios',
    target: 'mobile',
    artifactsDir: '/tmp/attempt-1',
  });
  // Parent object must not be mutated.
  assert.equal((parent as Record<string, unknown>).artifactsDir, undefined);
});

test('buildNestedReplayFlags threads artifactsDir through even when parent lacks it', () => {
  const result = buildNestedReplayFlags({
    parentFlags: undefined,
    platform: undefined,
    target: undefined,
    artifactsDir: '/tmp/attempt-1',
  });
  assert.deepEqual(result, { artifactsDir: '/tmp/attempt-1' });
});

test('buildNestedReplayFlags overrides a parent artifactsDir with the attempt-level one', () => {
  const result = buildNestedReplayFlags({
    parentFlags: { artifactsDir: '/suite-root' },
    platform: undefined,
    target: undefined,
    artifactsDir: '/suite-root/flow/attempt-2',
  });
  assert.equal(result?.artifactsDir, '/suite-root/flow/attempt-2');
});

test('collectReplayActionArtifactPaths includes failed action artifact details', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-artifacts-'));
  const snapshotPath = path.join(root, 'failure-snapshot.txt');
  fs.writeFileSync(snapshotPath, 'snapshot');

  const paths = collectReplayActionArtifactPaths({
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message: 'assertion failed',
      details: {
        artifactPaths: [snapshotPath, path.join(root, 'missing.txt')],
      },
    },
  });

  assert.deepEqual(paths, [snapshotPath]);
});
