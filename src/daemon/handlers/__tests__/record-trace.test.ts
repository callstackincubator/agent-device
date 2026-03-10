import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleRecordTraceCommands } from '../record-trace.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import { IOS_RUNNER_CONTAINER_BUNDLE_IDS } from '../../../platforms/ios/runner-client.ts';

type RecordTraceDeps = NonNullable<Parameters<typeof handleRecordTraceCommands>[0]['deps']>;
type RunnerCall = {
  command: string;
  outPath?: string;
  fps?: number;
  appBundleId?: string;
  logPath?: string;
  traceLogPath?: string;
};

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-record-trace-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

function makeIosDeviceSession(name: string, appBundleId?: string): SessionState {
  const session = makeSession(name, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  });
  if (appBundleId) {
    session.appBundleId = appBundleId;
  }
  return session;
}

async function runRecordCommand(params: {
  sessionStore: SessionStore;
  sessionName: string;
  positionals: string[];
  deps: RecordTraceDeps;
  logPath?: string;
  cwd?: string;
  flags?: { fps?: number; showTouches?: boolean };
}) {
  return handleRecordTraceCommands({
    req: {
      token: 't',
      session: params.sessionName,
      command: 'record',
      positionals: params.positionals,
      flags: params.flags ?? {},
      meta: params.cwd ? { cwd: params.cwd } : undefined,
    },
    sessionName: params.sessionName,
    sessionStore: params.sessionStore,
    logPath: params.logPath,
    deps: params.deps,
  });
}

function makeIosDeviceRunnerDeps(
  runnerCalls: RunnerCall[],
  runCmdCalls: Array<{ cmd: string; args: string[] }>,
): RecordTraceDeps {
  const runIosRunnerCommand: RecordTraceDeps['runIosRunnerCommand'] = async (_device, command, options) => {
    runnerCalls.push({
      command: command.command,
      outPath: command.outPath,
      fps: command.fps,
      appBundleId: command.appBundleId,
      logPath: options?.logPath,
      traceLogPath: options?.traceLogPath,
    });
    return {};
  };
  return {
    runCmd: async (cmd, args) => {
      runCmdCalls.push({ cmd, args });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    runCmdBackground: () => {
      throw new Error('runCmdBackground should not be used for iOS devices');
    },
    runIosRunnerCommand,
    readAndroidShowTouchesSetting: async () => null,
    setAndroidShowTouchesEnabled: async () => {},
    restoreAndroidShowTouchesSetting: async () => {},
    overlayRecordingTouches: async () => {},
  };
}

function makeRecordDeps(overrides: Partial<RecordTraceDeps> = {}): RecordTraceDeps {
  return {
    runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    runCmdBackground: () => {
      throw new Error('runCmdBackground should not be used in this test');
    },
    runIosRunnerCommand: async () => ({}),
    readAndroidShowTouchesSetting: async () => null,
    setAndroidShowTouchesEnabled: async () => {},
    restoreAndroidShowTouchesSetting: async () => {},
    overlayRecordingTouches: async () => {},
    ...overrides,
  };
}

test('record start/stop uses iOS runner on physical iOS devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const deps = makeIosDeviceRunnerDeps(runnerCalls, runCmdCalls);
  const finalOut = path.join(os.tmpdir(), `agent-device-test-record-${Date.now()}.mp4`);
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', finalOut],
    logPath: '/tmp/daemon.log',
    deps,
  });

  assert.ok(responseStart);
  assert.equal(responseStart?.ok, true);
  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0]?.command, 'recordStart');
  assert.match(runnerCalls[0]?.outPath ?? '', /^agent-device-recording-\d+\.mp4$/);
  assert.equal(runnerCalls[0]?.fps, undefined);
  assert.equal(runnerCalls[0]?.appBundleId, 'com.atebits.Tweetie2');
  assert.equal(runnerCalls[0]?.logPath, '/tmp/daemon.log');
  assert.equal(runnerCalls[0]?.traceLogPath, undefined);
  const startedRecording = sessionStore.get(sessionName)?.recording;
  assert.equal(startedRecording?.platform, 'ios-device-runner');
  const stagedRemotePath = startedRecording && startedRecording.platform === 'ios-device-runner'
    ? startedRecording.remotePath
    : undefined;
  assert.match(stagedRemotePath ?? '', /^tmp\/agent-device-recording-\d+\.mp4$/);

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    logPath: '/tmp/daemon.log',
    deps,
  });

  assert.ok(responseStop);
  assert.equal(responseStop?.ok, true);
  assert.equal(runnerCalls.length, 2);
  assert.equal(runnerCalls[1]?.command, 'recordStop');
  assert.equal(runnerCalls[1]?.appBundleId, 'com.atebits.Tweetie2');
  assert.equal(runCmdCalls.length, 1);
  assert.equal(runCmdCalls[0]?.cmd, 'xcrun');
  assert.deepEqual(runCmdCalls[0]?.args, [
    'devicectl',
    'device',
    'copy',
    'from',
    '--device',
    'ios-device-1',
    '--source',
    stagedRemotePath ?? '',
    '--destination',
    finalOut,
    '--domain-type',
    'appDataContainer',
    '--domain-identifier',
    IOS_RUNNER_CONTAINER_BUNDLE_IDS[0] ?? '',
  ]);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record start resolves relative output path from request cwd', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-cwd';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const deps = makeIosDeviceRunnerDeps(runnerCalls, runCmdCalls);
  const cwd = '/tmp/agent-device-cwd-test';
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    cwd,
    deps,
  });

  assert.equal(responseStart?.ok, true);
  assert.match(runnerCalls[0]?.outPath ?? '', /^agent-device-recording-\d+\.mp4$/);
  assert.equal(runnerCalls[0]?.fps, undefined);
  const startedRecording = sessionStore.get(sessionName)?.recording;
  assert.equal(startedRecording?.platform, 'ios-device-runner');
  if (startedRecording?.platform === 'ios-device-runner') {
    assert.equal(startedRecording.outPath, path.join(cwd, 'device.mp4'));
    assert.match(startedRecording.remotePath, /^tmp\/agent-device-recording-\d+\.mp4$/);
  }

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    cwd,
    deps,
  });
  assert.equal(runCmdCalls.length, 1);
});

test('record start forwards explicit fps to iOS runner', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-fps';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const deps = makeIosDeviceRunnerDeps(runnerCalls, runCmdCalls);
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    flags: { fps: 30 },
    deps,
  });

  assert.equal(response?.ok, true);
  assert.equal(runnerCalls[0]?.command, 'recordStart');
  assert.equal(runnerCalls[0]?.fps, 30);
  assert.equal(runCmdCalls.length, 0);
});

test('record start rejects invalid fps value', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-invalid-fps';
  sessionStore.set(sessionName, makeIosDeviceSession(sessionName));

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    flags: { fps: 0 },
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for invalid args');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runIosRunnerCommand should not be used for invalid args');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, false);
  assert.equal(response?.error?.code, 'INVALID_ARGS');
  assert.match(response?.error?.message ?? '', /fps must be an integer between 1 and 120/);
});

test('record start on iOS device requires active app session context', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-no-app';
  sessionStore.set(sessionName, makeIosDeviceSession(sessionName));

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runIosRunnerCommand should not be used without active app context');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, false);
  assert.equal(response?.error?.code, 'INVALID_ARGS');
  assert.match(response?.error?.message ?? '', /requires an active app session/i);
});

test('record start returns structured error when iOS runner start fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-start-fail';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner disconnected');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, false);
  assert.equal(response?.error?.code, 'COMMAND_FAILED');
  assert.match(response?.error?.message ?? '', /failed to start recording: runner disconnected/);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record start recovers from stale iOS runner recording state', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-runner-desync';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const commands: string[] = [];
  let startAttempts = 0;
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async (_device, command) => {
        commands.push(command.command);
        if (command.command === 'recordStart') {
          startAttempts += 1;
          if (startAttempts === 1) {
            throw new Error('recording already in progress');
          }
        }
        return {};
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(commands, ['recordStart', 'recordStop', 'recordStart']);
  assert.equal(sessionStore.get(sessionName)?.recording?.platform, 'ios-device-runner');
});

test('record start does not stop recording owned by another session during desync recovery', async () => {
  const sessionStore = makeSessionStore();
  const ownerSessionName = 'ios-device-owner';
  const ownerSession = makeIosDeviceSession(ownerSessionName, 'com.example.owner');
  ownerSession.recording = {
    platform: 'ios-device-runner',
    outPath: '/tmp/owner.mp4',
    remotePath: 'tmp/owner.mp4',
    startedAt: Date.now(),
    showTouches: false,
    gestureEvents: [],
  };
  sessionStore.set(ownerSessionName, ownerSession);

  const sessionName = 'ios-device-requester';
  const requesterSession = makeIosDeviceSession(sessionName, 'com.example.requester');
  sessionStore.set(sessionName, requesterSession);

  const commands: string[] = [];
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async (_device, command) => {
        commands.push(command.command);
        if (command.command === 'recordStart') {
          throw new Error('recording already in progress');
        }
        return {};
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, false);
  assert.equal(response?.error?.code, 'COMMAND_FAILED');
  assert.match(response?.error?.message ?? '', /already in progress in session 'ios-device-owner'/);
  assert.deepEqual(commands, ['recordStart']);
  assert.equal(sessionStore.get(ownerSessionName)?.recording?.platform, 'ios-device-runner');
});

test('record stop clears iOS runner recording state when runner stop fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-stop-fail';
  sessionStore.set(sessionName, {
    ...makeIosDeviceSession(sessionName),
    recording: {
      platform: 'ios-device-runner',
      outPath: '/tmp/device.mp4',
      remotePath: 'tmp/device.mp4',
      startedAt: Date.now(),
      showTouches: false,
      gestureEvents: [],
    },
  });

  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: {
      runCmd: async (cmd, args) => {
        runCmdCalls.push({ cmd, args });
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner disconnected');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(response?.data?.recording, 'stopped');
  assert.equal(runCmdCalls.length, 1);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record uses simctl recordVideo for iOS simulators', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'ios',
    id: 'sim-1',
    name: 'Simulator',
    kind: 'simulator',
    booted: true,
  }));

  let started = false;
  let stopped = false;
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './sim.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: (cmd, args) => {
        assert.equal(cmd, 'xcrun');
        assert.deepEqual(args.slice(0, 4), ['simctl', 'io', 'sim-1', 'recordVideo']);
        started = true;
        return {
          child: {
            kill: () => {
              stopped = true;
            },
          } as any,
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for iOS simulators');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(responseStart?.ok, true);
  assert.equal(started, true);

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for simulator');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for iOS simulators');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(stopped, true);
});

test('record keeps android pull + cleanup flow', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android';
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Android',
    kind: 'emulator',
    booted: true,
  }));

  const adbCalls: Array<string[]> = [];
  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    deps: {
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: (cmd, args) => {
        assert.equal(cmd, 'adb');
        assert.deepEqual(args.slice(0, 4), ['-s', 'emulator-5554', 'shell', 'screenrecord']);
        return {
          child: { kill: () => {} } as any,
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for Android');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: {
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for Android');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for Android');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(adbCalls.length, 2);
  assert.match(adbCalls[0]?.join(' '), /pull/);
  assert.match(adbCalls[1]?.join(' '), /shell rm -f/);
});

test('record start/stop manages Android tap indicators when show-touches is enabled', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-show-touches';
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Android',
    kind: 'emulator',
    booted: true,
  }));

  const adbCalls: Array<string[]> = [];
  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    flags: { showTouches: true },
    deps: {
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: () => ({
        child: { kill: () => {} } as any,
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      }),
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for Android');
      },
      readAndroidShowTouchesSetting: async () => '0',
      setAndroidShowTouchesEnabled: async () => {
        adbCalls.push(['shell', 'settings', 'put', 'system', 'show_touches', '1']);
      },
      restoreAndroidShowTouchesSetting: async (_device, value) => {
        adbCalls.push(['restore', String(value)]);
      },
      overlayRecordingTouches: async () => {},
    },
  });

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: {
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for Android');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for Android');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async (_device, value) => {
        adbCalls.push(['restore', String(value)]);
      },
      overlayRecordingTouches: async () => {},
    },
  });

  assert.ok(adbCalls.some((args) => args.join(' ') === 'shell settings put system show_touches 1'));
  assert.ok(adbCalls.some((args) => args.join(' ') === 'restore 0'));
});

test('record stop overlays gestures onto iOS recordings when show-touches is enabled', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-show-touches';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'Simulator',
      kind: 'simulator',
      booted: true,
    }),
    recording: {
      platform: 'ios',
      outPath: '/tmp/demo.mp4',
      startedAt: Date.now() - 500,
      showTouches: true,
      gestureEvents: [{ kind: 'tap', tMs: 120, x: 50, y: 80 }],
      child: { kill: () => {} } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    },
  });

  const overlayCalls: Array<{ videoPath: string; events: unknown[] }> = [];
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for simulator');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for iOS simulators');
      },
      readAndroidShowTouchesSetting: async () => null,
      setAndroidShowTouchesEnabled: async () => {},
      restoreAndroidShowTouchesSetting: async () => {},
      overlayRecordingTouches: async ({ videoPath, events }) => {
        overlayCalls.push({ videoPath, events });
      },
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(overlayCalls.length, 1);
  assert.equal(overlayCalls[0]?.videoPath, '/tmp/demo.mp4');
  assert.equal(overlayCalls[0]?.events.length, 1);
});

test('record stop clears iOS recording state when overlay export fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-show-touches-overlay-fail';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'Simulator',
      kind: 'simulator',
      booted: true,
    }),
    recording: {
      platform: 'ios',
      outPath: '/tmp/demo.mp4',
      startedAt: Date.now() - 500,
      showTouches: true,
      gestureEvents: [{ kind: 'tap', tMs: 120, x: 50, y: 80 }],
      child: { kill: () => {} } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    },
  });

  await assert.rejects(
    () =>
      runRecordCommand({
        sessionStore,
        sessionName,
        positionals: ['stop'],
        deps: makeRecordDeps({
          overlayRecordingTouches: async () => {
            throw new Error('overlay failed');
          },
        }),
      }),
    /overlay failed/,
  );

  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record stop clears Android recording state when tap indicator restore fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-show-touches-restore-fail';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'emulator',
      booted: true,
    }),
    recording: {
      platform: 'android',
      outPath: '/tmp/demo.mp4',
      remotePath: '/sdcard/demo.mp4',
      startedAt: Date.now() - 500,
      showTouches: true,
      androidShowTouchesSetting: '0',
      gestureEvents: [],
      child: { kill: () => {} } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    },
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: makeRecordDeps({
      restoreAndroidShowTouchesSetting: async () => {
        throw new Error('permission denied');
      },
    }),
  });

  assert.equal(response?.ok, false);
  assert.equal(response?.error?.code, 'COMMAND_FAILED');
  assert.match(response?.error?.message ?? '', /failed to restore Android tap indicators: permission denied/);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});
