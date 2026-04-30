import { expect, test, vi } from 'vitest';

vi.mock('../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/exec.ts')>();
  return {
    ...actual,
    runCmd: vi.fn(async (cmd: string) => {
      if (cmd === 'adb') {
        throw new Error('local adb must not be used');
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }),
    whichCmd: vi.fn(async (cmd: string) => cmd !== 'adb'),
  };
});
vi.mock('../device-ready.ts', () => ({
  DEVICE_READY_CACHE_TTL_MS: 5_000,
  clearDeviceReadyCacheForTests: vi.fn(),
  ensureDeviceReady: vi.fn(async () => {}),
}));

import { createRequestHandler } from '../request-router.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { makeSessionStore } from '../../__tests__/test-utils/store-factory.ts';
import type { AndroidAdbProvider } from '../../platforms/android/adb-executor.ts';

test('Android daemon commands route through injected provider without host adb', async () => {
  const sessionStore = makeSessionStore('agent-device-router-adb-provider-conformance-');
  sessionStore.set('default', {
    name: 'default',
    createdAt: Date.now(),
    device: {
      platform: 'android',
      id: 'remote-android-1',
      name: 'Remote Android',
      kind: 'device',
      booted: true,
    },
    appBundleId: 'com.example.app',
    actions: [],
  });
  const adbCalls: string[][] = [];
  const provider: AndroidAdbProvider = {
    exec: async (args) => {
      adbCalls.push(args);
      if (args.join(' ') === 'shell cmd clipboard get text') {
        return { stdout: 'clipboard text: hello', stderr: '', exitCode: 0 };
      }
      if (args.join(' ') === 'shell dumpsys input_method') {
        return { stdout: 'mInputShown=false inputType=0x1', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'shell' && args[1]?.startsWith('screenrecord ')) {
        return { stdout: '4242\n', stderr: '', exitCode: 0 };
      }
      if (args.join(' ').startsWith('shell stat -c %s /sdcard/agent-device-recording-')) {
        return { stdout: '100\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    },
  };
  const handler = createRequestHandler({
    logPath: '/tmp/daemon.log',
    token: 'token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
    androidAdbProvider: () => provider,
  });

  const clipboard = await handler({
    token: 'token',
    session: 'default',
    command: 'clipboard',
    positionals: ['read'],
    flags: {},
  });
  const keyboard = await handler({
    token: 'token',
    session: 'default',
    command: 'keyboard',
    positionals: ['status'],
    flags: {},
  });
  const doctor = await handler({
    token: 'token',
    session: 'default',
    command: 'logs',
    positionals: ['doctor'],
    flags: {},
  });
  const record = await handler({
    token: 'token',
    session: 'default',
    command: 'record',
    positionals: ['start'],
    flags: {},
  });

  expect(clipboard.ok).toBe(true);
  expect(keyboard.ok).toBe(true);
  expect(doctor.ok).toBe(true);
  expect(record.ok).toBe(true);
  expect(adbCalls).toContainEqual(['shell', 'cmd', 'clipboard', 'get', 'text']);
  expect(adbCalls).toContainEqual(['shell', 'dumpsys', 'input_method']);
  expect(adbCalls).toContainEqual(['shell', 'echo', 'ok']);
  expect(adbCalls).toContainEqual(['shell', 'pidof', 'com.example.app']);
  expect(adbCalls.some((args) => args[0] === 'shell' && args[1]?.startsWith('screenrecord '))).toBe(
    true,
  );
});
