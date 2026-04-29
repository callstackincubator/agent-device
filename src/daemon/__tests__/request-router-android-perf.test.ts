import { expect, test } from 'vitest';
import { createRequestHandler } from '../request-router.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { SessionStore } from '../session-store.ts';
import { AppError } from '../../utils/errors.ts';
import type {
  AndroidAdbExecutor,
  AndroidAdbProvider,
} from '../../platforms/android/adb-executor.ts';

function makeAndroidSessionStore(name: string): SessionStore {
  const sessionStore = new SessionStore(`/tmp/${name}`);
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
  return sessionStore;
}

function makeHandler(sessionStore: SessionStore, androidAdbProvider: () => AndroidAdbProvider) {
  return createRequestHandler({
    logPath: '/tmp/daemon.log',
    token: 'token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    androidAdbProvider,
    trackDownloadableArtifact: () => 'artifact-id',
  });
}

test('request handler routes Android perf through injected adb executor', async () => {
  const sessionStore = makeAndroidSessionStore('agent-device-request-router-perf-test');
  const adbCalls: string[][] = [];
  const adb: AndroidAdbExecutor = async (args) => {
    adbCalls.push(args);
    if (args.includes('meminfo')) {
      return { stdout: 'TOTAL PSS: 100 TOTAL RSS: 200', stderr: '', exitCode: 0 };
    }
    if (args.includes('cpuinfo')) {
      return {
        stdout: '3.0% 1234/com.example.app: 2.0% user + 1.0% kernel',
        stderr: '',
        exitCode: 0,
      };
    }
    return {
      stdout: ['Total frames rendered: 4', 'Janky frames: 1 (25.00%)'].join('\n'),
      stderr: '',
      exitCode: 0,
    };
  };
  const handler = makeHandler(sessionStore, () => ({ exec: adb }));

  const response = await handler({
    token: 'token',
    session: 'default',
    command: 'perf',
    positionals: [],
    flags: {},
  });

  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected perf response to succeed');
  expect((response.data?.metrics as Record<string, any>)?.fps?.droppedFramePercent).toBe(25);
  expect(adbCalls).toContainEqual(['shell', 'dumpsys', 'gfxinfo', 'com.example.app', 'reset']);
});

test('request handler reports injected Android adb failures per perf metric', async () => {
  const sessionStore = makeAndroidSessionStore('agent-device-request-router-perf-unavailable-test');
  const adb: AndroidAdbExecutor = async () => {
    throw new AppError('COMMAND_FAILED', 'Remote Android ADB executor is unavailable');
  };
  const handler = makeHandler(sessionStore, () => ({ exec: adb }));

  const response = await handler({
    token: 'token',
    session: 'default',
    command: 'perf',
    positionals: [],
    flags: {},
  });

  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected perf response to succeed');
  const metrics = response.data?.metrics as Record<string, any>;
  for (const metricName of ['memory', 'cpu', 'fps']) {
    const metric = metrics[metricName];
    expect(metric.available).toBe(false);
    expect(metric.reason).toBe('Remote Android ADB executor is unavailable');
    expect(metric.error.details.metric).toBe(metricName);
  }
});

test('request handler scopes generic Android commands through injected adb provider', async () => {
  const sessionStore = makeAndroidSessionStore('agent-device-request-router-adb-provider-test');
  const adbCalls: string[][] = [];
  const adbProvider: AndroidAdbProvider = {
    exec: async (args) => {
      adbCalls.push(args);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
  const handler = makeHandler(sessionStore, () => adbProvider);

  const response = await handler({
    token: 'token',
    session: 'default',
    command: 'press',
    positionals: ['10', '20'],
    flags: {},
  });

  expect(response.ok).toBe(true);
  expect(adbCalls).toContainEqual(['shell', 'input', 'tap', '10', '20']);
});
