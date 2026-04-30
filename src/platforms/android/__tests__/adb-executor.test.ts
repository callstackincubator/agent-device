import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return {
    ...actual,
    runCmd: vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })),
  };
});

import {
  createAndroidPortReverseManager,
  createDeviceAdbExecutor,
  createLocalAndroidAdbProvider,
  installAndroidAdbPackage,
  pullAndroidAdbFile,
  resolveAndroidAdbExecutor,
  resolveAndroidAdbProvider,
  withAndroidAdbProvider,
} from '../adb-executor.ts';
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
    { serial: 'emulator-5554' },
    async () => await adb(['shell', 'echo', 'local']),
  );

  assert.equal(result.stdout, 'ok');
  assert.deepEqual(providerCalls, []);
  assert.deepEqual(mockRunCmd.mock.calls, [
    ['adb', ['-s', 'emulator-5554', 'shell', 'echo', 'local'], undefined],
  ]);
});

test('scoped provider only resolves for the matching device serial', async () => {
  mockRunCmd.mockClear();
  const providerCalls: string[][] = [];
  const otherDevice = {
    platform: 'android',
    id: 'other-device',
    name: 'Other Android',
    kind: 'device',
    booted: true,
  } as const;

  const result = await withAndroidAdbProvider(
    async (args) => {
      providerCalls.push(args);
      return { stdout: 'provider', stderr: '', exitCode: 0 };
    },
    { serial: 'emulator-5554' },
    async () => {
      const adb = resolveAndroidAdbExecutor(otherDevice);
      const provider = resolveAndroidAdbProvider(otherDevice);
      await provider.exec(['shell', 'echo', 'provider-fallback']);
      return await adb(['shell', 'echo', 'executor-fallback']);
    },
  );

  assert.equal(result.stdout, 'ok');
  assert.deepEqual(providerCalls, []);
  assert.deepEqual(
    mockRunCmd.mock.calls.map((call) => call[1]),
    [
      ['-s', 'other-device', 'shell', 'echo', 'provider-fallback'],
      ['-s', 'other-device', 'shell', 'echo', 'executor-fallback'],
    ],
  );
});

test('createLocalAndroidAdbProvider exposes exec, spawn, and reverse over local adb', async () => {
  mockRunCmd.mockClear();
  const provider = createLocalAndroidAdbProvider({
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel Emulator',
    kind: 'emulator',
    booted: true,
  });

  await provider.exec(['shell', 'echo', 'ok']);
  await provider.reverse?.ensure({ local: 'tcp:8081', remote: 'tcp:8081', ownerId: 'session-a' });
  await provider.reverse?.removeAllOwned('session-a');

  assert.deepEqual(
    mockRunCmd.mock.calls.map((call) => call[1]),
    [
      ['-s', 'emulator-5554', 'shell', 'echo', 'ok'],
      ['-s', 'emulator-5554', 'reverse', 'tcp:8081', 'tcp:8081'],
      ['-s', 'emulator-5554', 'reverse', '--remove', 'tcp:8081'],
    ],
  );
});

test('createLocalAndroidAdbProvider exposes local pull and install capabilities', async () => {
  mockRunCmd.mockClear();
  const provider = createLocalAndroidAdbProvider({
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel Emulator',
    kind: 'emulator',
    booted: true,
  });

  await provider.pull?.('/sdcard/video.mp4', '/tmp/video.mp4', { allowFailure: true });
  await provider.install?.('/tmp/app.apk', {
    allowDowngrade: true,
    allowTestPackages: true,
    grantPermissions: true,
    replace: true,
    timeoutMs: 2000,
  });

  assert.deepEqual(mockRunCmd.mock.calls, [
    [
      'adb',
      ['-s', 'emulator-5554', 'pull', '/sdcard/video.mp4', '/tmp/video.mp4'],
      { allowFailure: true },
    ],
    [
      'adb',
      ['-s', 'emulator-5554', 'install', '-r', '-t', '-d', '-g', '/tmp/app.apk'],
      { timeoutMs: 2000 },
    ],
  ]);
});

test('createAndroidPortReverseManager makes duplicate setup idempotent and cleans owner mappings', async () => {
  const calls: string[][] = [];
  const manager = createAndroidPortReverseManager(async (args) => {
    calls.push(args);
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  await manager.ensure({ local: 'tcp:8081', remote: 'tcp:8081', ownerId: 'session-a' });
  await manager.ensure({ local: 'tcp:8081', remote: 'tcp:8081', ownerId: 'session-a' });
  await manager.ensure({ local: 'tcp:8082', remote: 'tcp:8081', ownerId: 'session-a' });
  await manager.removeAllOwned('session-a');

  assert.deepEqual(calls, [
    ['reverse', 'tcp:8081', 'tcp:8081'],
    ['reverse', 'tcp:8082', 'tcp:8081'],
    ['reverse', '--remove', 'tcp:8081'],
    ['reverse', '--remove', 'tcp:8082'],
  ]);
});

test('createAndroidPortReverseManager rejects mappings owned by another session', async () => {
  const manager = createAndroidPortReverseManager(async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }));

  await manager.ensure({ local: 'tcp:8081', remote: 'tcp:8081', ownerId: 'session-a' });
  await assert.rejects(
    () => manager.ensure({ local: 'tcp:8081', remote: 'tcp:8082', ownerId: 'session-b' }),
    /already owned by session-a/,
  );
});

test('createAndroidPortReverseManager lists parsed reverse mappings with owners', async () => {
  const manager = createAndroidPortReverseManager(async (args) => {
    if (args.join(' ') === 'reverse --list') {
      return {
        stdout: [
          'emulator-5554 tcp:8081 tcp:8081',
          'emulator-5554 localabstract:metro tcp:9090',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  await manager.ensure({ local: 'tcp:8081', remote: 'tcp:8081', ownerId: 'session-a' });
  const mappings = await manager.list?.();

  assert.deepEqual(mappings, [
    { local: 'tcp:8081', remote: 'tcp:8081', ownerId: 'session-a' },
    { local: 'localabstract:metro', remote: 'tcp:9090', ownerId: undefined },
  ]);
});

test('resolveAndroidAdbProvider does not infer reverse support for plain executors', () => {
  const provider = resolveAndroidAdbProvider(
    {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    },
    async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  );

  assert.equal(provider.reverse, undefined);
});

test('explicit transfer helpers prefer provider capabilities over exec-shaped fallback', async () => {
  const calls: string[] = [];

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        calls.push(`exec:${args.join(' ')}`);
        return { stdout: 'exec', stderr: '', exitCode: 0 };
      },
      pull: async (remotePath, localPath) => {
        calls.push(`pull:${remotePath}:${localPath}`);
        return { stdout: 'pull', stderr: '', exitCode: 0 };
      },
      install: async (source, options) => {
        calls.push(`install:${String(source)}:${options?.replace === true}`);
        return { stdout: 'install', stderr: '', exitCode: 0 };
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await pullAndroidAdbFile('/remote.mp4', '/local.mp4');
      await installAndroidAdbPackage('/app.apk', { replace: true });
    },
  );

  assert.deepEqual(calls, ['pull:/remote.mp4:/local.mp4', 'install:/app.apk:true']);
});

test('explicit transfer helpers keep exec-shaped fallback for older providers', async () => {
  const calls: string[][] = [];

  await withAndroidAdbProvider(
    async (args) => {
      calls.push(args);
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    },
    { serial: 'emulator-5554' },
    async () => {
      await pullAndroidAdbFile('/remote.mp4', '/local.mp4');
      await installAndroidAdbPackage('/app.apk', { replace: true });
    },
  );

  assert.deepEqual(calls, [
    ['pull', '/remote.mp4', '/local.mp4'],
    ['install', '-r', '/app.apk'],
  ]);
});
