import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createLocalAppleToolProvider,
  runAppleToolCommand,
  runAppleToolCommandSync,
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

test('scoped Apple tool provider handles synchronous tool execution', async () => {
  const calls: Array<[string, string[]]> = [];
  const provider = createLocalAppleToolProvider({
    runCommandSync: (cmd, args) => {
      calls.push([cmd, args]);
      return { exitCode: 0, stdout: '{"ok":true}', stderr: '' };
    },
  });

  const result = await withAppleToolProvider(provider, async () =>
    runAppleToolCommandSync('plutil', ['-convert', 'json', '-o', '-', 'Runner.xctestrun']),
  );

  assert.equal(result.stdout, '{"ok":true}');
  assert.deepEqual(calls, [['plutil', ['-convert', 'json', '-o', '-', 'Runner.xctestrun']]]);
});
