import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createLocalAppleToolProvider,
  runAppleToolCommand,
  runXcrun,
  withAppleToolProvider,
} from '../tool-provider.ts';

test('scoped Apple tool provider handles xcrun execution', async () => {
  const calls: Array<[string, string[]]> = [];
  const provider = createLocalAppleToolProvider({
    runCommand: async (cmd, args) => {
      calls.push([cmd, args]);
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });

  const result = await withAppleToolProvider(
    provider,
    async () => await runXcrun(['simctl', 'launch', 'sim-1', 'com.example.app']),
  );

  assert.equal(result.stdout, 'ok');
  assert.deepEqual(calls, [['xcrun', ['simctl', 'launch', 'sim-1', 'com.example.app']]]);
});

test('scoped Apple tool provider handles non-xcrun tool execution', async () => {
  const calls: Array<[string, string[]]> = [];
  const provider = createLocalAppleToolProvider({
    runCommand: async (cmd, args) => {
      calls.push([cmd, args]);
      return { exitCode: 0, stdout: 'focused', stderr: '' };
    },
  });

  const result = await withAppleToolProvider(
    provider,
    async () => await runAppleToolCommand('open', ['-a', 'Simulator']),
  );

  assert.equal(result.stdout, 'focused');
  assert.deepEqual(calls, [['open', ['-a', 'Simulator']]]);
});
