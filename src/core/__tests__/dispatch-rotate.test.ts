import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../platforms/ios/runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/runner-client.ts')>();
  return { ...actual, runIosRunnerCommand: vi.fn() };
});

import { dispatchCommand } from '../dispatch.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const mockRunIosRunnerCommand = vi.mocked(runIosRunnerCommand);

const ANDROID_DEVICE: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

const IOS_DEVICE: DeviceInfo = {
  platform: 'ios',
  id: 'ios-device-1',
  name: 'iPhone',
  kind: 'device',
  booted: true,
};

async function withMockedAdb(
  tempPrefix: string,
  run: (argsLogPath: string) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    await run(argsLogPath);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRunIosRunnerCommand.mockResolvedValue({ message: 'rotate', orientation: 'landscape-left' });
});

test('dispatch rotate normalizes aliases before Android execution', async () => {
  await withMockedAdb('agent-device-dispatch-rotate-android-', async (argsLogPath) => {
    const result = await dispatchCommand(ANDROID_DEVICE, 'rotate', ['left']);

    assert.equal(result?.action, 'rotate');
    assert.equal(result?.orientation, 'landscape-left');

    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.match(logged, /shell\nsettings\nput\nsystem\naccelerometer_rotation\n0/);
    assert.match(logged, /shell\nsettings\nput\nsystem\nuser_rotation\n1/);
  });
});

test('dispatch rotate sends normalized orientation to the iOS runner', async () => {
  const result = await dispatchCommand(IOS_DEVICE, 'rotate', ['right'], undefined, {
    appBundleId: 'com.example.app',
  });

  assert.equal(result?.action, 'rotate');
  assert.equal(result?.orientation, 'landscape-right');
  assert.equal(mockRunIosRunnerCommand.mock.calls.length, 1);
  assert.deepEqual(mockRunIosRunnerCommand.mock.calls[0]?.[1], {
    command: 'rotate',
    orientation: 'landscape-right',
    appBundleId: 'com.example.app',
  });
});
