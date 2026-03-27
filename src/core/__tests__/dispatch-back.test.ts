import { test } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchCommand } from '../dispatch.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const ANDROID_DEVICE: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
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

test('dispatch back defaults to in-app mode and keeps Android back on keyevent 4', async () => {
  await withMockedAdb('agent-device-dispatch-back-modes-', async (argsLogPath) => {
    for (const backMode of [undefined, 'in-app', 'system'] as const) {
      const result = await dispatchCommand(ANDROID_DEVICE, 'back', [], undefined, {
        backMode,
      });

      assert.equal(result?.action, 'back');
      assert.equal(result?.mode, backMode ?? 'in-app');
    }

    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, [
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'keyevent',
      '4',
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'keyevent',
      '4',
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'keyevent',
      '4',
    ]);
  });
});
