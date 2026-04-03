import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceInfo } from '../../../utils/device.ts';
import {
  acquireXcodebuildSimulatorSetRedirect,
  findXctestrun,
  resolveXcodebuildSimulatorDeviceSetPath,
  scoreXctestrunCandidate,
} from '../runner-xctestrun.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

const iosDevice: DeviceInfo = {
  platform: 'ios',
  id: 'device-1',
  name: 'iPhone',
  kind: 'device',
  booted: true,
};

test('findXctestrun prefers simulator xctestrun over newer macos candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-xctestrun-'));
  try {
    const simulatorPath = path.join(
      root,
      'Build',
      'Products',
      'AgentDeviceRunner_AgentDeviceRunner_iphonesimulator26.2-arm64-x86_64.xctestrun',
    );
    const macosPath = path.join(
      root,
      'macos',
      'Build',
      'Products',
      'AgentDeviceRunner.env.session-123.xctestrun',
    );
    fs.mkdirSync(path.dirname(simulatorPath), { recursive: true });
    fs.mkdirSync(path.dirname(macosPath), { recursive: true });
    fs.writeFileSync(simulatorPath, 'sim');
    fs.writeFileSync(macosPath, 'mac');
    const now = new Date();
    fs.utimesSync(simulatorPath, now, now);
    fs.utimesSync(macosPath, new Date(now.getTime() + 5_000), new Date(now.getTime() + 5_000));

    assert.equal(findXctestrun(root, iosSimulator), simulatorPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findXctestrun prefers base xctestrun over newer env xctestrun for matching platform', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-xctestrun-'));
  try {
    const basePath = path.join(
      root,
      'Build',
      'Products',
      'AgentDeviceRunner_AgentDeviceRunner_iphoneos26.2-arm64.xctestrun',
    );
    const envPath = path.join(
      root,
      'Build',
      'Products',
      'AgentDeviceRunner.env.session-456.xctestrun',
    );
    fs.mkdirSync(path.dirname(basePath), { recursive: true });
    fs.writeFileSync(basePath, 'base');
    fs.writeFileSync(envPath, 'env');
    const now = new Date();
    fs.utimesSync(basePath, now, now);
    fs.utimesSync(envPath, new Date(now.getTime() + 5_000), new Date(now.getTime() + 5_000));

    assert.equal(findXctestrun(root, iosDevice), basePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoreXctestrunCandidate penalizes macos and env xctestrun files for simulator runs', () => {
  const simulatorScore = scoreXctestrunCandidate(
    '/tmp/derived/Build/Products/AgentDeviceRunner_AgentDeviceRunner_iphonesimulator26.2-arm64.xctestrun',
    iosSimulator,
  );
  const macosEnvScore = scoreXctestrunCandidate(
    '/tmp/derived/macos/Build/Products/AgentDeviceRunner.env.session-123.xctestrun',
    iosSimulator,
  );

  assert.ok(simulatorScore > macosEnvScore);
});

test('resolveXcodebuildSimulatorDeviceSetPath uses XCTestDevices under the user home', () => {
  assert.equal(
    resolveXcodebuildSimulatorDeviceSetPath('/tmp/agent-device-home'),
    '/tmp/agent-device-home/Library/Developer/XCTestDevices',
  );
});

test('acquireXcodebuildSimulatorSetRedirect swaps XCTestDevices to the requested simulator set', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-xctestrun-redirect-'));
  let handle: Awaited<ReturnType<typeof acquireXcodebuildSimulatorSetRedirect>> | null = null;
  try {
    const requestedSetPath = path.join(root, 'requested');
    const xctestDeviceSetPath = path.join(root, 'Library', 'Developer', 'XCTestDevices');
    const lockDirPath = path.join(root, '.agent-device', 'xctest-device-set.lock');
    const originalMarkerPath = path.join(root, 'original-marker.txt');
    fs.mkdirSync(requestedSetPath, { recursive: true });
    fs.mkdirSync(xctestDeviceSetPath, { recursive: true });
    fs.writeFileSync(path.join(xctestDeviceSetPath, 'original.txt'), originalMarkerPath, 'utf8');

    handle = await acquireXcodebuildSimulatorSetRedirect(
      {
        ...iosSimulator,
        simulatorSetPath: requestedSetPath,
      },
      { lockDirPath, xctestDeviceSetPath },
    );

    assert.notEqual(handle, null);
    assert.equal(fs.lstatSync(xctestDeviceSetPath).isSymbolicLink(), true);
    assert.equal(
      fs.realpathSync.native(xctestDeviceSetPath),
      fs.realpathSync.native(requestedSetPath),
    );

    await handle?.release();
    handle = null;

    assert.equal(fs.lstatSync(xctestDeviceSetPath).isDirectory(), true);
    assert.equal(
      fs.readFileSync(path.join(xctestDeviceSetPath, 'original.txt'), 'utf8'),
      originalMarkerPath,
    );
  } finally {
    await handle?.release();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('acquireXcodebuildSimulatorSetRedirect is a no-op for simulators without a scoped device set', async () => {
  const handle = await acquireXcodebuildSimulatorSetRedirect(iosSimulator);
  assert.equal(handle, null);
});

test('acquireXcodebuildSimulatorSetRedirect restores stale redirected XCTestDevices before applying a new one', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-xctestrun-redirect-'));
  let handle: Awaited<ReturnType<typeof acquireXcodebuildSimulatorSetRedirect>> | null = null;
  try {
    const requestedSetPath = path.join(root, 'requested');
    const staleRequestedSetPath = path.join(root, 'stale-requested');
    const xctestDeviceSetPath = path.join(root, 'Library', 'Developer', 'XCTestDevices');
    const backupPath = `${xctestDeviceSetPath}.agent-device-backup`;
    const lockDirPath = path.join(root, '.agent-device', 'xctest-device-set.lock');
    fs.mkdirSync(requestedSetPath, { recursive: true });
    fs.mkdirSync(staleRequestedSetPath, { recursive: true });
    fs.mkdirSync(path.dirname(xctestDeviceSetPath), { recursive: true });
    fs.mkdirSync(backupPath, { recursive: true });
    fs.writeFileSync(path.join(backupPath, 'original.txt'), 'restored', 'utf8');
    fs.symlinkSync(staleRequestedSetPath, xctestDeviceSetPath, 'dir');

    handle = await acquireXcodebuildSimulatorSetRedirect(
      {
        ...iosSimulator,
        simulatorSetPath: requestedSetPath,
      },
      { backupPath, lockDirPath, xctestDeviceSetPath },
    );

    assert.notEqual(handle, null);
    assert.equal(
      fs.realpathSync.native(xctestDeviceSetPath),
      fs.realpathSync.native(requestedSetPath),
    );

    await handle?.release();
    handle = null;

    assert.equal(fs.existsSync(backupPath), false);
    assert.equal(
      fs.readFileSync(path.join(xctestDeviceSetPath, 'original.txt'), 'utf8'),
      'restored',
    );
  } finally {
    await handle?.release();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('acquireXcodebuildSimulatorSetRedirect clears stale lock directories from dead owners', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-xctestrun-redirect-'));
  let handle: Awaited<ReturnType<typeof acquireXcodebuildSimulatorSetRedirect>> | null = null;
  try {
    const requestedSetPath = path.join(root, 'requested');
    const xctestDeviceSetPath = path.join(root, 'Library', 'Developer', 'XCTestDevices');
    const lockDirPath = path.join(root, '.agent-device', 'xctest-device-set.lock');
    fs.mkdirSync(requestedSetPath, { recursive: true });
    fs.mkdirSync(lockDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(lockDirPath, 'owner.json'),
      JSON.stringify({ pid: 999_999, startTime: null, acquiredAtMs: Date.now() - 60_000 }),
      'utf8',
    );

    handle = await acquireXcodebuildSimulatorSetRedirect(
      {
        ...iosSimulator,
        simulatorSetPath: requestedSetPath,
      },
      { lockDirPath, xctestDeviceSetPath },
    );

    assert.notEqual(handle, null);
    assert.equal(fs.lstatSync(xctestDeviceSetPath).isSymbolicLink(), true);

    await handle?.release();
    handle = null;

    assert.equal(fs.existsSync(lockDirPath), false);
  } finally {
    await handle?.release();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
