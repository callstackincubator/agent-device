import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn(actual.runCmd) };
});

import { parseApplePsOutput, sampleApplePerfMetrics } from '../perf.ts';
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
  vi.useRealTimers();
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

test('sampleApplePerfMetrics uses xctrace Activity Monitor for iOS devices', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-01T10:00:00.000Z'));

  const firstCaptureXml = [
    '<?xml version="1.0"?>',
    '<trace-query-result>',
    '<node xpath="//trace-toc[1]/run[1]/data[1]/table[7]">',
    '<schema name="activity-monitor-process-live">',
    '<col><mnemonic>start</mnemonic></col>',
    '<col><mnemonic>process</mnemonic></col>',
    '<col><mnemonic>cpu-total</mnemonic></col>',
    '<col><mnemonic>memory-real</mnemonic></col>',
    '<col><mnemonic>pid</mnemonic></col>',
    '</schema>',
    '<row>',
    '<start-time fmt="00:00.123">123</start-time>',
    '<process fmt="ExampleDeviceApp (4001)"><pid fmt="4001">4001</pid></process>',
    '<duration-on-core fmt="100.00 ms">100000000</duration-on-core>',
    '<size-in-bytes fmt="8.00 MiB">8388608</size-in-bytes>',
    '<pid fmt="4001">4001</pid>',
    '<process ref="background-process"/>',
    '</row>',
    '<row>',
    '<start-time fmt="00:00.124">124</start-time>',
    '<process fmt="OtherApp (5001)"><pid fmt="5001">5001</pid></process>',
    '<duration-on-core fmt="75.00 ms">75000000</duration-on-core>',
    '<size-in-bytes fmt="4.00 MiB">4194304</size-in-bytes>',
    '<pid fmt="5001">5001</pid>',
    '</row>',
    '</node>',
    '</trace-query-result>',
  ].join('');
  const secondCaptureXml = firstCaptureXml
    .replace(
      '<duration-on-core fmt="100.00 ms">100000000</duration-on-core>',
      '<duration-on-core id="cpu-ref" fmt="350.00 ms">350000000</duration-on-core>',
    )
    .replace(
      '<size-in-bytes fmt="8.00 MiB">8388608</size-in-bytes>',
      '<size-in-bytes id="mem-ref" fmt="8.00 MiB">8388608</size-in-bytes>',
    )
    .replace('<pid fmt="4001">4001</pid>', '<pid id="pid-ref" fmt="4001">4001</pid>')
    .replace(
      '<process fmt="ExampleDeviceApp (4001)"><pid fmt="4001">4001</pid></process>',
      '<process id="proc-ref" fmt="ExampleDeviceApp (4001)"><pid fmt="4001">4001</pid></process>',
    )
    .replace(
      '</row><row><start-time fmt="00:00.124">124</start-time>',
      [
        '</row>',
        '<row>',
        '<start-time fmt="00:00.123">123</start-time>',
        '<process ref="proc-ref"/>',
        '<duration-on-core ref="cpu-ref"/>',
        '<size-in-bytes ref="mem-ref"/>',
        '<pid ref="pid-ref"/>',
        '<process ref="background-process"/>',
        '</row>',
        '<row>',
        '<start-time fmt="00:00.124">124</start-time>',
      ].join(''),
    );
  let exportCount = 0;

  mockRunCmd.mockImplementation(async (cmd, args) => {
    if (cmd !== 'xcrun') {
      throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
    }
    if (
      args[0] === 'devicectl' &&
      args[1] === 'device' &&
      args[2] === 'info' &&
      args[3] === 'apps'
    ) {
      const outputIndex = args.indexOf('--json-output');
      await fs.writeFile(
        args[outputIndex + 1]!,
        JSON.stringify({
          result: {
            apps: [
              {
                bundleIdentifier: 'com.example.device',
                name: 'Example Device App',
                url: 'file:///private/var/containers/Bundle/Application/ABC123/ExampleDevice.app/',
              },
            ],
          },
        }),
        'utf8',
      );
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (
      args[0] === 'devicectl' &&
      args[1] === 'device' &&
      args[2] === 'info' &&
      args[3] === 'processes'
    ) {
      const outputIndex = args.indexOf('--json-output');
      await fs.writeFile(
        args[outputIndex + 1]!,
        JSON.stringify({
          result: {
            runningProcesses: [
              {
                executable:
                  'file:///private/var/containers/Bundle/Application/ABC123/ExampleDevice.app/ExampleDeviceApp',
                processIdentifier: 4001,
              },
            ],
          },
        }),
        'utf8',
      );
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'xctrace' && args[1] === 'record') {
      vi.setSystemTime(new Date(Date.now() + 1000));
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'xctrace' && args[1] === 'export') {
      const outputIndex = args.indexOf('--output');
      exportCount += 1;
      await fs.writeFile(
        args[outputIndex + 1]!,
        exportCount === 1 ? firstCaptureXml : secondCaptureXml,
        'utf8',
      );
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    throw new Error(`unexpected xcrun args: ${args.join(' ')}`);
  });

  const metrics = await sampleApplePerfMetrics(IOS_DEVICE, 'com.example.device');
  assert.equal(metrics.cpu.usagePercent, 25);
  assert.equal(metrics.memory.residentMemoryKb, 8192);
  assert.equal(metrics.cpu.method, 'xctrace-activity-monitor');
  assert.deepEqual(metrics.cpu.matchedProcesses, ['ExampleDeviceApp']);
  assert.equal(metrics.cpu.measuredAt, '2026-04-01T10:00:02.000Z');
  assert.equal(metrics.memory.measuredAt, '2026-04-01T10:00:02.000Z');
});
