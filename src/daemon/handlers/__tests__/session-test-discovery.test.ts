import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../../utils/errors.ts';
import { discoverReplayTestEntries } from '../session-test-discovery.ts';

test('discoverReplayTestEntries expands directories in deterministic path order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-discovery-'));
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, '02-second.ad'), 'context platform=android\nopen "Second"\n');
  fs.writeFileSync(path.join(root, '01-first.ad'), 'context platform=ios\nopen "First"\n');

  const entries = discoverReplayTestEntries({ inputs: [root], cwd: root });

  assert.deepEqual(
    entries.map((entry) => entry.path),
    [path.join(root, '01-first.ad'), path.join(nested, '02-second.ad')],
  );
});

test('discoverReplayTestEntries skips untyped scripts when platform filter is set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-discovery-filter-'));
  fs.writeFileSync(path.join(root, '01-untyped.ad'), 'open "Demo"\n');
  fs.writeFileSync(path.join(root, '02-android.ad'), 'context platform=android\nopen "Demo"\n');

  const entries = discoverReplayTestEntries({
    inputs: [root],
    cwd: root,
    platformFilter: 'android',
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['skip', 'run'],
  );
  assert.equal(entries[0]?.kind, 'skip');
  if (entries[0]?.kind === 'skip') {
    assert.match(entries[0].message, /missing platform metadata for --platform android/);
  }
});

test('discoverReplayTestEntries rejects empty post-filter suites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-discovery-empty-'));
  fs.writeFileSync(path.join(root, '01-ios.ad'), 'context platform=ios\nopen "Settings"\n');

  assert.throws(
    () => discoverReplayTestEntries({ inputs: [root], cwd: root, platformFilter: 'android' }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'No replay tests matched for --platform android.',
  );
});

test('discoverReplayTestEntries includes Maestro yaml flows for Maestro test suites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-discovery-maestro-'));
  fs.writeFileSync(path.join(root, '01-flow.yaml'), 'appId: demo\n---\n- launchApp\n');
  fs.writeFileSync(path.join(root, '02-flow.yml'), 'appId: demo\n---\n- launchApp\n');
  fs.writeFileSync(path.join(root, '03-flow.ad'), 'open "Demo"\n');

  const entries = discoverReplayTestEntries({
    inputs: [root],
    cwd: root,
    platformFilter: 'android',
    replayBackend: 'maestro',
  });

  assert.deepEqual(
    entries.map((entry) => path.basename(entry.path)),
    ['01-flow.yaml', '02-flow.yml', '03-flow.ad'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['run', 'run', 'run'],
  );
});
