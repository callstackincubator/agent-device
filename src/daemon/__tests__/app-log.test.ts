import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  APP_LOG_PID_FILENAME,
  appendAppLogMarker,
  assertAndroidPackageArgSafe,
  buildIosDeviceLogStreamArgs,
  buildIosLogPredicate,
  cleanupStaleAppLogProcesses,
  getAppLogPathMetadata,
  runAppLogDoctor,
  rotateAppLogIfNeeded,
  stopAppLog,
} from '../app-log.ts';

test('buildIosLogPredicate includes bundle-aware filters', () => {
  const predicate = buildIosLogPredicate('com.example.app');
  assert.match(predicate, /subsystem == "com\.example\.app"/);
  assert.match(predicate, /processImagePath ENDSWITH\[c\] "\/com\.example\.app"/);
  assert.match(predicate, /senderImagePath ENDSWITH\[c\] "\/com\.example\.app"/);
  assert.match(predicate, /eventMessage CONTAINS\[c\] "com\.example\.app"/);
});

test('assertAndroidPackageArgSafe rejects unsafe values', () => {
  assert.doesNotThrow(() => assertAndroidPackageArgSafe('com.example.app'));
  assert.throws(() => assertAndroidPackageArgSafe('com.example.app;rm -rf /'), /Invalid Android package/);
});

test('rotateAppLogIfNeeded rotates and truncates oldest by configured max files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-app-log-rotate-'));
  const outPath = path.join(root, 'app.log');
  fs.writeFileSync(outPath, 'a'.repeat(20));
  fs.writeFileSync(`${outPath}.1`, 'old1');
  fs.writeFileSync(`${outPath}.2`, 'old2');

  rotateAppLogIfNeeded(outPath, { maxBytes: 10, maxRotatedFiles: 2 });

  assert.equal(fs.existsSync(outPath), false);
  assert.equal(fs.readFileSync(`${outPath}.1`, 'utf8').length, 20);
  assert.equal(fs.readFileSync(`${outPath}.2`, 'utf8'), 'old1');
});

test('stopAppLog delegates stop and waits for completion', async () => {
  let stopped = false;
  let resolved = false;
  const wait = new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve({ stdout: '', stderr: '', exitCode: 0 });
    }, 5);
  });
  await stopAppLog({
    backend: 'android',
    getState: () => 'active',
    startedAt: Date.now(),
    stop: async () => {
      stopped = true;
    },
    wait,
  });
  assert.equal(stopped, true);
  assert.equal(resolved, true);
});

test('cleanupStaleAppLogProcesses removes pid files even when pid is stale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-app-log-clean-'));
  const sessionDir = path.join(root, 'default');
  fs.mkdirSync(sessionDir, { recursive: true });
  const pidPath = path.join(sessionDir, APP_LOG_PID_FILENAME);
  fs.writeFileSync(pidPath, '999999\n');

  cleanupStaleAppLogProcesses(root);

  assert.equal(fs.existsSync(pidPath), false);
});

test('buildIosDeviceLogStreamArgs builds expected devicectl command args', () => {
  assert.deepEqual(buildIosDeviceLogStreamArgs('00008150-0000AAAA'), [
    'devicectl',
    'device',
    'log',
    'stream',
    '--device',
    '00008150-0000AAAA',
  ]);
});

test('cleanupStaleAppLogProcesses removes legacy plain pid files safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-app-log-clean-legacy-'));
  const sessionDir = path.join(root, 'default');
  fs.mkdirSync(sessionDir, { recursive: true });
  const pidPath = path.join(sessionDir, APP_LOG_PID_FILENAME);
  fs.writeFileSync(pidPath, '1\n');

  cleanupStaleAppLogProcesses(root);

  assert.equal(fs.existsSync(pidPath), false);
});

test('appendAppLogMarker writes marker lines and metadata reflects file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-app-log-mark-'));
  const outPath = path.join(root, 'app.log');
  appendAppLogMarker(outPath, 'checkpoint');
  const content = fs.readFileSync(outPath, 'utf8');
  assert.match(content, /checkpoint/);
  const metadata = getAppLogPathMetadata(outPath);
  assert.equal(metadata.exists, true);
  assert.ok(metadata.sizeBytes > 0);
});

test('runAppLogDoctor returns note when app bundle is missing', async () => {
  const result = await runAppLogDoctor({
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
  });
  assert.equal(Array.isArray(result.notes), true);
  assert.ok(result.notes.some((note) => note.includes('Run open <app> first')));
});
