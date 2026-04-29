import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return {
    ...actual,
    runCmd: vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })),
  };
});

import { createDeviceAdbExecutor, withAndroidAdbProvider } from '../adb-executor.ts';
import { runCmd } from '../../../utils/exec.ts';

const mockRunCmd = vi.mocked(runCmd);

test('createDeviceAdbExecutor routes local commands through adb with the device serial', async () => {
  const adb = createDeviceAdbExecutor({
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel Emulator',
    kind: 'emulator',
    booted: true,
  });

  const result = await adb(['shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 1000 });

  assert.deepEqual(result, { stdout: 'ok', stderr: '', exitCode: 0 });
  assert.deepEqual(mockRunCmd.mock.calls, [
    ['adb', ['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 1000 }],
  ]);
});

test('createDeviceAdbExecutor remains a local adb executor inside provider scopes', async () => {
  mockRunCmd.mockClear();
  const providerCalls: string[][] = [];
  const adb = createDeviceAdbExecutor({
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel Emulator',
    kind: 'emulator',
    booted: true,
  });

  const result = await withAndroidAdbProvider(
    async (args) => {
      providerCalls.push(args);
      return { stdout: 'provider', stderr: '', exitCode: 0 };
    },
    async () => await adb(['shell', 'echo', 'local']),
  );

  assert.equal(result.stdout, 'ok');
  assert.deepEqual(providerCalls, []);
  assert.deepEqual(mockRunCmd.mock.calls, [
    ['adb', ['-s', 'emulator-5554', 'shell', 'echo', 'local'], undefined],
  ]);
});
