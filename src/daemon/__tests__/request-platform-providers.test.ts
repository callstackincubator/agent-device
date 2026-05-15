import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  ANDROID_EMULATOR,
  IOS_SIMULATOR,
  makeAndroidSession,
  makeIosSession,
} from '../../__tests__/test-utils/index.ts';
import { createLocalAppleToolProvider, runXcrun } from '../../platforms/ios/tool-provider.ts';
import { withRequestPlatformProviderScope } from '../request-platform-providers.ts';
import type { DaemonRequest } from '../types.ts';

test('request platform provider scope exposes Android executor for Android sessions', async () => {
  const calls: string[][] = [];
  const response = await withRequestPlatformProviderScope(
    {
      req: request('snapshot'),
      existingSession: makeAndroidSession('default'),
      providers: {
        androidAdbProvider: ({ device, session }) => {
          assert.equal(device.id, ANDROID_EMULATOR.id);
          assert.equal(session?.name, 'default');
          return {
            exec: async (args) => {
              calls.push(args);
              return { exitCode: 0, stdout: 'ok', stderr: '' };
            },
          };
        },
      },
    },
    async (scope) => {
      assert.ok(scope.androidAdbExecutor);
      return await scope.androidAdbExecutor(['shell', 'echo', 'ok']);
    },
  );

  assert.equal(response.stdout, 'ok');
  assert.deepEqual(calls, [['shell', 'echo', 'ok']]);
});

test('request platform provider scope applies Apple tool provider only for Apple sessions', async () => {
  const calls: string[][] = [];

  const result = await withRequestPlatformProviderScope(
    {
      req: request('open'),
      existingSession: makeIosSession('default'),
      providers: {
        appleToolProvider: ({ device }) => {
          assert.equal(device.id, IOS_SIMULATOR.id);
          return createLocalAppleToolProvider({
            runCommand: async (cmd, args) => {
              throw new Error(`unexpected generic command: ${cmd} ${args.join(' ')}`);
            },
            simctl: {
              run: async (args) => {
                calls.push(args);
                return { exitCode: 0, stdout: 'simctl-ok', stderr: '' };
              },
            },
          });
        },
        linuxToolProvider: () => {
          throw new Error('Linux provider should not apply to an iOS session');
        },
      },
    },
    async () => await runXcrun(['simctl', 'list', 'devices', '-j']),
  );

  assert.equal(result.stdout, 'simctl-ok');
  assert.deepEqual(calls, [['list', 'devices', '-j']]);
});

function request(command: string): DaemonRequest {
  return {
    token: 'test-token',
    session: 'default',
    command,
    positionals: [],
    flags: {},
    meta: { requestId: `req-${command}` },
  };
}
