import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  ANDROID_EMULATOR,
  IOS_SIMULATOR,
  makeAndroidSession,
  makeIosSession,
} from '../../__tests__/test-utils/index.ts';
import { createLocalAppleToolProvider, runXcrun } from '../../platforms/ios/tool-provider.ts';
import { startAppLog } from '../app-log.ts';
import { resolveRecordingProvider } from '../recording-provider.ts';
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

test('request platform provider scope treats undefined resolver results as no provider', async () => {
  const response = await withRequestPlatformProviderScope(
    {
      req: request('snapshot'),
      existingSession: makeAndroidSession('default'),
      providers: {
        androidAdbProvider: () => undefined,
      },
    },
    async (scope) => {
      assert.equal(scope.androidAdbExecutor, undefined);
      return 'local-fallback';
    },
  );

  assert.equal(response, 'local-fallback');
});

test('request platform provider scope surfaces resolver failures instead of falling back local', async () => {
  await assert.rejects(
    async () =>
      await withRequestPlatformProviderScope(
        {
          req: request('snapshot'),
          existingSession: makeAndroidSession('default'),
          providers: {
            androidAdbProvider: () => {
              throw new Error('provider unavailable');
            },
          },
        },
        async () => 'unexpected',
      ),
    /provider unavailable/,
  );
});

test('request platform provider scope applies app log provider for session logs', async () => {
  const started: string[] = [];

  const result = await withRequestPlatformProviderScope(
    {
      req: request('logs'),
      existingSession: makeIosSession('default'),
      providers: {
        appLogProvider: ({ device, session }) => {
          assert.equal(device.id, IOS_SIMULATOR.id);
          assert.equal(session?.name, 'default');
          return {
            start: async ({ appBundleId }) => {
              started.push(appBundleId);
              return {
                backend: 'ios-simulator',
                startedAt: 123,
                getState: () => 'active',
                stop: async () => {},
                wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
              };
            },
          };
        },
      },
    },
    async () => await startAppLog(IOS_SIMULATOR, 'com.example.app', '/tmp/app.log'),
  );

  assert.equal(result.backend, 'ios-simulator');
  assert.deepEqual(started, ['com.example.app']);
});

test('request platform provider scope applies recording provider for session recordings', async () => {
  const starts: string[] = [];

  const result = await withRequestPlatformProviderScope(
    {
      req: request('record'),
      existingSession: makeIosSession('default'),
      providers: {
        recordingProvider: ({ device, session }) => {
          assert.equal(device.id, IOS_SIMULATOR.id);
          assert.equal(session?.name, 'default');
          return {
            startIosSimulatorRecording: ({ outPath }) => {
              starts.push(outPath);
              return {
                child: { kill: () => true },
                wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
              };
            },
          };
        },
      },
    },
    async () =>
      resolveRecordingProvider().startIosSimulatorRecording({
        device: IOS_SIMULATOR,
        outPath: '/tmp/simulator.mp4',
      }),
  );

  assert.equal(result.child.kill('SIGINT'), true);
  assert.deepEqual(starts, ['/tmp/simulator.mp4']);
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

test('request platform provider scopes stay isolated across concurrent requests', async () => {
  const androidCalls: string[] = [];
  const appleCalls: string[] = [];
  let androidEntered!: () => void;
  let appleEntered!: () => void;
  const androidInProvider = new Promise<void>((resolve) => {
    androidEntered = resolve;
  });
  const appleInProvider = new Promise<void>((resolve) => {
    appleEntered = resolve;
  });
  const bothProvidersEntered = Promise.all([androidInProvider, appleInProvider]);

  const androidTask = withRequestPlatformProviderScope(
    {
      req: { ...request('snapshot'), meta: { requestId: 'req-android' } },
      existingSession: makeAndroidSession('android-session'),
      providers: {
        androidAdbProvider: ({ device, session }) => ({
          exec: async (args) => {
            androidCalls.push(`${session?.name}:${device.id}:${args.join(' ')}`);
            androidEntered();
            await bothProvidersEntered;
            return { exitCode: 0, stdout: 'android-ok', stderr: '' };
          },
        }),
        appleToolProvider: () => {
          throw new Error('Apple provider should not apply to an Android request');
        },
      },
    },
    async (scope) => {
      assert.ok(scope.androidAdbExecutor);
      return (await scope.androidAdbExecutor(['shell', 'echo', 'android'])).stdout;
    },
  );

  const appleTask = withRequestPlatformProviderScope(
    {
      req: { ...request('snapshot'), meta: { requestId: 'req-apple' } },
      existingSession: makeIosSession('ios-session'),
      providers: {
        androidAdbProvider: () => {
          throw new Error('Android provider should not apply to an Apple request');
        },
        appleToolProvider: ({ device, session }) =>
          createLocalAppleToolProvider({
            runCommand: async (cmd, args) => {
              throw new Error(`unexpected generic command: ${cmd} ${args.join(' ')}`);
            },
            simctl: {
              run: async (args) => {
                appleCalls.push(`${session?.name}:${device.id}:${args.join(' ')}`);
                appleEntered();
                await bothProvidersEntered;
                return { exitCode: 0, stdout: 'apple-ok', stderr: '' };
              },
            },
          }),
      },
    },
    async () => (await runXcrun(['simctl', 'list', 'devices', '-j'])).stdout,
  );

  assert.deepEqual(await Promise.all([androidTask, appleTask]), ['android-ok', 'apple-ok']);
  assert.deepEqual(androidCalls, [`android-session:${ANDROID_EMULATOR.id}:shell echo android`]);
  assert.deepEqual(appleCalls, [`ios-session:${IOS_SIMULATOR.id}:list devices -j`]);
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
