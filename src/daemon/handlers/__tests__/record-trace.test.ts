import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleRecordTraceCommands } from '../record-trace.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';

type RecordTraceDeps = NonNullable<Parameters<typeof handleRecordTraceCommands>[0]['deps']>;

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

async function runRecordCommand(params: {
  sessionStore: SessionStore;
  sessionName: string;
  positionals: string[];
  deps: RecordTraceDeps;
  logPath?: string;
  cwd?: string;
  flags?: { fps?: number };
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
  runnerCalls: Array<{ command: string; outPath?: string; fps?: number; appBundleId?: string; logPath?: string; traceLogPath?: string }>,
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
  };
}

test('record start/stop uses iOS runner on physical iOS devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  const session = makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  });
  session.appBundleId = 'com.atebits.Tweetie2';
  sessionStore.set(sessionName, session);

  const runnerCalls: Array<{ command: string; outPath?: string; fps?: number; appBundleId?: string; logPath?: string; traceLogPath?: string }> = [];
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
  assert.equal(runnerCalls[0]?.appBundleId, undefined);
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
  assert.equal(runnerCalls[1]?.appBundleId, undefined);
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
    'com.myapp.AgentDeviceRunnerUITests.xctrunner',
  ]);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record start resolves relative output path from request cwd', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-cwd';
  const session = makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  });
  sessionStore.set(sessionName, session);

  const runnerCalls: Array<{ command: string; outPath?: string; fps?: number; appBundleId?: string; logPath?: string; traceLogPath?: string }> = [];
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
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  }));

  const runnerCalls: Array<{ command: string; outPath?: string; fps?: number; appBundleId?: string; logPath?: string; traceLogPath?: string }> = [];
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
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  }));

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
    },
  });

  assert.equal(response?.ok, false);
  assert.equal(response?.error?.code, 'INVALID_ARGS');
  assert.match(response?.error?.message ?? '', /fps must be an integer between 1 and 120/);
});

test('record start returns structured error when iOS runner start fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-start-fail';
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  }));

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
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  }));

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
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(commands, ['recordStart', 'recordStop', 'recordStart']);
  assert.equal(sessionStore.get(sessionName)?.recording?.platform, 'ios-device-runner');
});

test('record stop clears iOS runner recording state when runner stop fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-stop-fail';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
    recording: { platform: 'ios-device-runner', outPath: '/tmp/device.mp4', remotePath: 'tmp/device.mp4' },
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
    },
  });

  assert.equal(adbCalls.length, 2);
  assert.match(adbCalls[0]?.join(' '), /pull/);
  assert.match(adbCalls[1]?.join(' '), /shell rm -f/);
});
