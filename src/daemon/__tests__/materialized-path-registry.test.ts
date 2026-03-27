import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupRetainedMaterializedPaths,
  cleanupRetainedMaterializedPathsForSession,
  retainMaterializedPaths,
} from '../materialized-path-registry.ts';

test('retainMaterializedPaths copies file and directory artifacts into managed storage', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-retained-paths-'));
  const archivePath = path.join(tempRoot, 'Sample.zip');
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(archivePath, 'archive-bytes');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Info.plist'), 'plist');

  const retained = await retainMaterializedPaths({
    archivePath,
    installablePath: appPath,
    ttlMs: 60_000,
  });

  assert.notEqual(retained.archivePath, archivePath);
  assert.notEqual(retained.installablePath, appPath);
  assert.equal(fs.existsSync(retained.archivePath ?? ''), true);
  assert.equal(fs.existsSync(retained.installablePath), true);
  assert.equal(fs.readFileSync(retained.archivePath ?? '', 'utf8'), 'archive-bytes');
  assert.equal(fs.readFileSync(path.join(retained.installablePath, 'Info.plist'), 'utf8'), 'plist');

  await cleanupRetainedMaterializedPaths(retained.materializationId);
  assert.equal(fs.existsSync(retained.archivePath ?? ''), false);
  assert.equal(fs.existsSync(retained.installablePath), false);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('cleanupRetainedMaterializedPathsForSession removes retained paths bound to a session', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-retained-session-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Info.plist'), 'plist');

  const retained = await retainMaterializedPaths({
    installablePath: appPath,
    sessionName: 'session-one',
    ttlMs: 60_000,
  });

  assert.equal(fs.existsSync(retained.installablePath), true);
  await cleanupRetainedMaterializedPathsForSession('session-one');
  assert.equal(fs.existsSync(retained.installablePath), false);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
