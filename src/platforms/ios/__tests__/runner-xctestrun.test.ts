import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceInfo } from '../../../utils/device.ts';
import { findXctestrun, scoreXctestrunCandidate } from '../runner-xctestrun.ts';

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
