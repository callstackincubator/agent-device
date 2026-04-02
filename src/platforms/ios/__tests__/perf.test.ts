import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn(actual.runCmd) };
});

import { sampleApplePerfMetrics, parseApplePsOutput } from '../perf.ts';
import { runCmd } from '../../../utils/exec.ts';
import type { DeviceInfo } from '../../../utils/device.ts';

const mockRunCmd = vi.mocked(runCmd);

const IOS_SIMULATOR: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone 17 Pro',
  kind: 'simulator',
  booted: true,
};

const MACOS_DEVICE: DeviceInfo = {
  platform: 'macos',
  id: 'host-mac',
  name: 'Host Mac',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

const IOS_DEVICE: DeviceInfo = {
  platform: 'ios',
  id: 'ios-device-1',
  name: 'iPhone Device',
  kind: 'device',
  booted: true,
};

beforeEach(() => {
  vi.resetAllMocks();
});

test('parseApplePsOutput reads pid cpu rss and command columns', () => {
  const rows = parseApplePsOutput(
    ['123 12.5 45678 /Applications/Test.app/Contents/MacOS/Test --flag', '456 0.0 2048 Test'].join(
      '\n',
    ),
  );

  assert.deepEqual(rows, [
    {
      pid: 123,
      cpuPercent: 12.5,
      rssKb: 45678,
      command: '/Applications/Test.app/Contents/MacOS/Test --flag',
    },
    {
      pid: 456,
      cpuPercent: 0,
      rssKb: 2048,
      command: 'Test',
    },
  ]);
});

test('sampleApplePerfMetrics aggregates host ps metrics for macOS app bundle', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-macos-perf-'));
  const bundlePath = path.join(tmpDir, 'Example.app');
  await fs.mkdir(path.join(bundlePath, 'Contents'), { recursive: true });
  await fs.writeFile(
    path.join(bundlePath, 'Contents', 'Info.plist'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      '<key>CFBundleExecutable</key><string>ExampleExec</string>',
      '</dict></plist>',
    ].join(''),
    'utf8',
  );

  mockRunCmd.mockImplementation(async (cmd, args) => {
    if (cmd === 'mdfind') {
      return { stdout: `${bundlePath}\n`, stderr: '', exitCode: 0 };
    }
    if (cmd === 'plutil') {
      return { stdout: '', stderr: 'mock fallback', exitCode: 1 };
    }
    if (cmd === 'ps') {
      return {
        stdout: [
          `111 8.5 12000 ${path.join(bundlePath, 'Contents', 'MacOS', 'ExampleExec')}`,
          `222 1.5 5000 ${path.join(bundlePath, 'Contents', 'MacOS', 'ExampleExec')} --helper`,
          '333 9.0 9999 /Applications/Other.app/Contents/MacOS/Other',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      };
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  });

  try {
    const metrics = await sampleApplePerfMetrics(MACOS_DEVICE, 'com.example.app');
    assert.equal(metrics.cpu.usagePercent, 10);
    assert.equal(metrics.memory.residentMemoryKb, 17000);
    assert.deepEqual(metrics.cpu.matchedProcesses, ['ExampleExec']);
    assert.deepEqual(metrics.memory.matchedProcesses, ['ExampleExec']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('sampleApplePerfMetrics uses simctl spawn ps for iOS simulators', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-sim-perf-'));
  const appPath = path.join(tmpDir, 'Example.app');
  await fs.mkdir(appPath, { recursive: true });
  await fs.writeFile(
    path.join(appPath, 'Info.plist'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      '<key>CFBundleExecutable</key><string>ExampleSimExec</string>',
      '</dict></plist>',
    ].join(''),
    'utf8',
  );

  mockRunCmd.mockImplementation(async (cmd, args) => {
    if (cmd === 'xcrun' && args.includes('get_app_container')) {
      return { stdout: `${appPath}\n`, stderr: '', exitCode: 0 };
    }
    if (cmd === 'plutil') {
      return { stdout: '', stderr: 'mock fallback', exitCode: 1 };
    }
    if (cmd === 'xcrun' && args.includes('spawn') && args.includes('ps')) {
      return {
        stdout: ['111 12.0 8192 ExampleSimExec', '222 4.0 1024 SpringBoard'].join('\n'),
        stderr: '',
        exitCode: 0,
      };
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  });

  try {
    const metrics = await sampleApplePerfMetrics(IOS_SIMULATOR, 'com.example.sim');
    assert.equal(metrics.cpu.usagePercent, 12);
    assert.equal(metrics.memory.residentMemoryKb, 8192);
    assert.deepEqual(metrics.cpu.matchedProcesses, ['ExampleSimExec']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('sampleApplePerfMetrics rejects physical iOS devices for now', async () => {
  await assert.rejects(
    () => sampleApplePerfMetrics(IOS_DEVICE, 'com.example.device'),
    /not yet implemented for physical iOS devices/i,
  );
});
