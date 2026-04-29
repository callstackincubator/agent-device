import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { test } from 'vitest';
import { runCmd } from '../../../utils/exec.ts';
import { spawnAndroidAdbBySerial, withAndroidAdbProvider } from '../adb-executor.ts';

test('withAndroidAdbProvider intercepts scoped adb commands with a device serial', async () => {
  const calls: string[][] = [];

  const result = await withAndroidAdbProvider(
    async (args, options) => {
      calls.push(args);
      return {
        stdout: options?.allowFailure ? 'allowed' : 'ok',
        stderr: '',
        exitCode: 0,
      };
    },
    async () =>
      await runCmd('adb', ['-s', 'emulator-5554', 'shell', 'echo', 'ok'], {
        allowFailure: true,
      }),
  );

  assert.equal(result.stdout, 'allowed');
  assert.deepEqual(calls, [['shell', 'echo', 'ok']]);
});

test('spawnAndroidAdbBySerial uses the scoped provider spawner', async () => {
  const child = { pid: 123 } as ChildProcess;
  const calls: string[][] = [];

  const result = await withAndroidAdbProvider(
    {
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      spawn: (args) => {
        calls.push(args);
        return child;
      },
    },
    async () => spawnAndroidAdbBySerial('emulator-5554', ['logcat', '-v', 'time']),
  );

  assert.equal(result, child);
  assert.deepEqual(calls, [['logcat', '-v', 'time']]);
});
