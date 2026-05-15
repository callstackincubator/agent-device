import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createLocalAppleToolProvider,
  readApplePlistJson,
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

test('scoped Apple tool provider prefers semantic simctl and devicectl hooks', async () => {
  const calls: Array<[string, string[]]> = [];
  const provider = createLocalAppleToolProvider({
    runCommand: async (cmd, args) => {
      calls.push([cmd, args]);
      return { exitCode: 0, stdout: 'generic', stderr: '' };
    },
    simctl: {
      run: async (args) => {
        calls.push(['simctl', args]);
        return { exitCode: 0, stdout: 'simctl', stderr: '' };
      },
    },
    devicectl: {
      run: async (args) => {
        calls.push(['devicectl', args]);
        return { exitCode: 0, stdout: 'devicectl', stderr: '' };
      },
    },
  });

  const simctlResult = await withAppleToolProvider(
    provider,
    async () => await runXcrun(['simctl', 'launch', 'sim-1', 'com.example.app']),
  );
  const devicectlResult = await withAppleToolProvider(
    provider,
    async () => await runXcrun(['devicectl', 'device', 'info', 'details']),
  );

  assert.equal(simctlResult.stdout, 'simctl');
  assert.equal(devicectlResult.stdout, 'devicectl');
  assert.deepEqual(calls, [
    ['simctl', ['launch', 'sim-1', 'com.example.app']],
    ['devicectl', ['device', 'info', 'details']],
  ]);
});

test('scoped Apple tool provider exposes plist JSON reads as semantic operation', async () => {
  const provider = createLocalAppleToolProvider({
    runCommand: async () => {
      throw new Error('generic command fallback should not be used for plist reads');
    },
    plist: {
      readJson: async (plistPath) => ({ plistPath, ok: true }),
    },
  });

  const result = await withAppleToolProvider(
    provider,
    async () => await readApplePlistJson('/tmp/Runner.xctestrun'),
  );

  assert.deepEqual(result, { plistPath: '/tmp/Runner.xctestrun', ok: true });
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
