import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { makeAndroidSession } from '../../../__tests__/test-utils/index.ts';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';
import type { DaemonRequest, DaemonResponse } from '../../types.ts';
import { handleSessionCommands } from '../session.ts';

const noopInvoke = async (_req: DaemonRequest): Promise<DaemonResponse> => ({ ok: true, data: {} });

function expectOk(response: DaemonResponse | null): Extract<DaemonResponse, { ok: true }> {
  if (!response || !response.ok) throw new Error('Expected daemon success response.');
  return response;
}

function expectFailure(response: DaemonResponse | null): Extract<DaemonResponse, { ok: false }> {
  if (!response || response.ok) throw new Error('Expected daemon failure response.');
  return response;
}

test('perf frames returns focused frame-health payload', async () => {
  const sessionStore = makeSessionStore('agent-device-session-perf-area-');
  const sessionName = 'perf-session-frames';
  sessionStore.set(sessionName, makeAndroidSession(sessionName));

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'perf',
      positionals: ['frames'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  const data = expectOk(response).data as Record<string, unknown>;
  const metrics = data.metrics as Record<string, any>;
  const sampling = data.sampling as Record<string, any>;
  expect(metrics.fps.available).toBe(false);
  expect(String(metrics.fps.reason)).toMatch(/no android app package/i);
  expect(metrics.startup).toBeUndefined();
  expect(metrics.memory).toBeUndefined();
  expect(metrics.cpu).toBeUndefined();
  expect(sampling.fps.method).toBe('adb-shell-dumpsys-gfxinfo-framestats');
  expect(sampling.startup).toBeUndefined();
});

test('perf frames samples only frame health for app-bound Android sessions', async () => {
  const sessionStore = makeSessionStore('agent-device-session-perf-area-');
  const sessionName = 'perf-session-frames-android-app';
  sessionStore.set(
    sessionName,
    makeAndroidSession(sessionName, { appBundleId: 'com.example.app' }),
  );
  const adbCalls: string[][] = [];

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'perf',
      positionals: ['frames'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    androidAdbExecutor: async (args) => {
      adbCalls.push(args);
      return {
        stdout: androidFrameStatsFixture(),
        stderr: '',
        exitCode: 0,
      };
    },
  });

  const data = expectOk(response).data as Record<string, unknown>;
  const metrics = data.metrics as Record<string, any>;
  expect(metrics.fps.available).toBe(true);
  expect(metrics.memory).toBeUndefined();
  expect(metrics.cpu).toBeUndefined();
  expect(adbCalls).toEqual([
    ['shell', 'dumpsys', 'gfxinfo', 'com.example.app', 'framestats'],
    ['shell', 'dumpsys', 'gfxinfo', 'com.example.app', 'reset'],
  ]);
});

test('perf rejects unknown area subcommands', async () => {
  const sessionStore = makeSessionStore('agent-device-session-perf-area-');
  const sessionName = 'perf-session-invalid-area';
  sessionStore.set(sessionName, makeAndroidSession(sessionName));

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'perf',
      positionals: ['cpu'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  const failure = expectFailure(response);
  expect(failure.error.code).toBe('INVALID_ARGS');
  expect(failure.error.message).toMatch(/perf area must be metrics or frames/i);
});

function androidFrameStatsFixture(): string {
  return [
    'Stats since: 123456789ns',
    '---PROFILEDATA---',
    'Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted',
    '0,1000000000,1000000000,0,0,0,0,0,0,0,0,0,0,1010000000,0,0,1010000000',
    '0,1016666667,1016666667,0,0,0,0,0,0,0,0,0,0,1034666667,0,0,1034666667',
    '0,1033333334,1033333334,0,0,0,0,0,0,0,0,0,0,1063333334,0,0,1063333334',
    '---PROFILEDATA---',
  ].join('\n');
}
