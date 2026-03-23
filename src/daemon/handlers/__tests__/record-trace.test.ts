import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleRecordTraceCommands } from '../record-trace.ts';
import { deriveRecordingTelemetryPath } from '../../recording-telemetry.ts';
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

function makeMacOsSession(name: string, appBundleId?: string): SessionState {
  const session = makeSession(name, {
    platform: 'macos',
    id: 'host-macos-local',
    name: 'Host Mac',
    kind: 'device',
    target: 'desktop',
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
  flags?: { fps?: number; hideTouches?: boolean };
  clientArtifactPaths?: Record<string, string>;
}) {
  return handleRecordTraceCommands({
    req: {
      token: 't',
      session: params.sessionName,
      command: 'record',
      positionals: params.positionals,
      flags: params.flags ?? {},
      meta:
        params.cwd || params.clientArtifactPaths
          ? {
              ...(params.cwd ? { cwd: params.cwd } : {}),
              ...(params.clientArtifactPaths
                ? { clientArtifactPaths: params.clientArtifactPaths }
                : {}),
            }
          : undefined,
    },
    sessionName: params.sessionName,
    sessionStore: params.sessionStore,
    logPath: params.logPath,
    deps: params.deps,
  });
}

function makeRunnerRecordingDeps(
  runnerCalls: RunnerCall[],
  runCmdCalls: Array<{ cmd: string; args: string[] }>,
): RecordTraceDeps {
  const runIosRunnerCommand: RecordTraceDeps['runIosRunnerCommand'] = async (
    _device,
    command,
    options,
  ) => {
    runnerCalls.push({
      command: command.command,
      outPath: command.outPath,
      fps: command.fps,
      appBundleId: command.appBundleId,
      logPath: options?.logPath,
      traceLogPath: options?.traceLogPath,
    });
    if (command.command === 'recordStart') {
      return { recorderStartUptimeMs: 12_345, targetAppReadyUptimeMs: 15_678 };
    }
    return {};
  };
  return {
    runCmd: async (cmd, args) => {
      runCmdCalls.push({ cmd, args });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    runCmdBackground: () => {
      throw new Error('runCmdBackground should not be used for runner-backed recording');
    },
    runIosRunnerCommand,
    waitForStableFile: async () => {},
    isPlayableVideo: async () => true,
    writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
    trimRecordingStart: async () => {},
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
    waitForStableFile: async () => {},
    isPlayableVideo: async () => true,
    writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
    trimRecordingStart: async () => {},
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
  const deps = makeRunnerRecordingDeps(runnerCalls, runCmdCalls);
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
  assert.equal(responseStart?.data?.showTouches, true);
  const startedRecording = sessionStore.get(sessionName)?.recording;
  assert.equal(startedRecording?.platform, 'ios-device-runner');
  const stagedRemotePath =
    startedRecording && startedRecording.platform === 'ios-device-runner'
      ? startedRecording.remotePath
      : undefined;
  assert.match(stagedRemotePath ?? '', /^tmp\/agent-device-recording-\d+\.mp4$/);
  if (startedRecording?.platform === 'ios-device-runner') {
    assert.equal(startedRecording.runnerStartedAtUptimeMs, 12_345);
    assert.equal(startedRecording.targetAppReadyUptimeMs, 15_678);
    assert.equal(startedRecording.showTouches, true);
  }

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
  assert.equal(responseStop?.data?.telemetryPath, deriveRecordingTelemetryPath(finalOut));
  assert.deepEqual(
    responseStop?.data?.artifacts?.map((artifact) => artifact.field),
    ['outPath', 'telemetryPath'],
  );
  assert.equal(responseStop?.data?.artifacts?.[1]?.path, deriveRecordingTelemetryPath(finalOut));
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record start/stop uses runner on macOS desktop sessions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-runner';
  sessionStore.set(sessionName, makeMacOsSession(sessionName, 'com.apple.systempreferences'));

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const deps = makeRunnerRecordingDeps(runnerCalls, runCmdCalls);
  const finalOut = path.join(os.tmpdir(), `agent-device-test-macos-record-${Date.now()}.mp4`);
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', finalOut],
    logPath: '/tmp/daemon.log',
    deps,
  });

  assert.equal(responseStart?.ok, true);
  assert.equal(runnerCalls.length, 1);
  assert.deepEqual(runnerCalls[0], {
    command: 'recordStart',
    outPath: finalOut,
    fps: undefined,
    appBundleId: 'com.apple.systempreferences',
    logPath: '/tmp/daemon.log',
    traceLogPath: undefined,
  });
  assert.equal(sessionStore.get(sessionName)?.recording?.platform, 'macos-runner');
  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    logPath: '/tmp/daemon.log',
    deps,
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(runnerCalls.length, 2);
  assert.equal(runnerCalls[1]?.command, 'recordStop');
  assert.equal(runnerCalls[1]?.appBundleId, 'com.apple.systempreferences');
  assert.equal(runCmdCalls.length, 0);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record stop derives telemetry artifact local path from client outPath', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-remote-artifacts';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const deps = makeIosDeviceRunnerDeps(runnerCalls, runCmdCalls);
  const finalOut = path.join(os.tmpdir(), `agent-device-test-record-${Date.now()}.mp4`);

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', finalOut],
    deps,
    clientArtifactPaths: { outPath: finalOut },
  });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps,
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(responseStop?.data?.artifacts?.[1]?.field, 'telemetryPath');
  assert.equal(
    responseStop?.data?.artifacts?.[1]?.localPath,
    deriveRecordingTelemetryPath(finalOut),
  );
  assert.equal(responseStop?.data?.telemetryPath, deriveRecordingTelemetryPath(finalOut));
});

test('record start resolves relative output path from request cwd', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-cwd';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  const deps = makeRunnerRecordingDeps(runnerCalls, runCmdCalls);
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
    assert.match(startedRecording.remotePath ?? '', /^tmp\/agent-device-recording-\d+\.mp4$/);
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
  const deps = makeRunnerRecordingDeps(runnerCalls, runCmdCalls);
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
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
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
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
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
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
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
        return { recorderStartUptimeMs: 11_000, targetAppReadyUptimeMs: 12_000 };
      },
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
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
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
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
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(response?.data?.recording, 'stopped');
  assert.equal(runCmdCalls.length, 1);
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record stop trims iOS device recordings from target app readiness before overlays', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-trim';
  sessionStore.set(sessionName, {
    ...makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2'),
    recording: {
      platform: 'ios-device-runner',
      outPath: '/tmp/device.mp4',
      remotePath: 'tmp/device.mp4',
      startedAt: Date.now(),
      runnerStartedAtUptimeMs: 10_000,
      targetAppReadyUptimeMs: 13_250,
      showTouches: true,
      gestureEvents: [{ kind: 'tap', tMs: 3_600, x: 50, y: 80 }],
    },
  });

  const lifecycleCalls: string[] = [];
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: makeRecordDeps({
      trimRecordingStart: async ({ videoPath, trimStartMs }) => {
        lifecycleCalls.push(`trim:${videoPath}:${trimStartMs}`);
      },
      writeRecordingTelemetry: ({ videoPath, events }) => {
        lifecycleCalls.push(`telemetry:${videoPath}:${events.length}`);
        return deriveRecordingTelemetryPath(videoPath);
      },
      overlayRecordingTouches: async ({ videoPath, telemetryPath }) => {
        lifecycleCalls.push(`overlay:${videoPath}:${telemetryPath}`);
      },
    }),
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(lifecycleCalls, [
    'trim:/tmp/device.mp4:3250',
    'telemetry:/tmp/device.mp4:1',
    `overlay:/tmp/device.mp4:${deriveRecordingTelemetryPath('/tmp/device.mp4')}`,
  ]);
});

test('record uses simctl recordVideo for iOS simulators', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );

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
        assert.equal(args[4], path.resolve('./sim.mp4'));
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
        return {};
      },
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      trimRecordingStart: async () => {},
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
      runIosRunnerCommand: async () => ({}),
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      trimRecordingStart: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(stopped, true);
});

test('record stop keeps iOS simulator video when overlay export fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim-overlay-warning';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './sim-warning.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => ({
        child: { kill: () => {} } as any,
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      }),
      runIosRunnerCommand: async () => ({}),
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
      overlayRecordingTouches: async () => {
        throw new Error('swift export failed');
      },
    },
  });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for simulator');
      },
      runIosRunnerCommand: async () => ({}),
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
      overlayRecordingTouches: async () => {
        throw new Error('swift export failed');
      },
    },
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(
    responseStop?.data?.overlayWarning,
    'failed to overlay recording touches: swift export failed',
  );
});

test('record start does not fail when iOS simulator runner warm-up fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim-warm-failure';
  const session = makeSession(sessionName, {
    platform: 'ios',
    id: 'sim-1',
    name: 'Simulator',
    kind: 'simulator',
    booted: true,
  });
  session.appBundleId = 'com.apple.Preferences';
  sessionStore.set(sessionName, session);

  let started = false;
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './sim.mp4'],
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        started = true;
        return {
          child: { kill: () => {} } as any,
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner warm-up unavailable');
      },
      waitForStableFile: async () => {},
      isPlayableVideo: async () => true,
      writeRecordingTelemetry: ({ videoPath }) => deriveRecordingTelemetryPath(videoPath),
      trimRecordingStart: async () => {},
      overlayRecordingTouches: async () => {},
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(started, true);
});

test('record start/stop overlays Android gestures by default on devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-overlay';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'device',
      booted: true,
    }),
  );

  const adbCalls: Array<string[]> = [];
  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        if (
          /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            args.join(' '),
          )
        ) {
          return { stdout: '4321\n', stderr: '', exitCode: 0 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            args.join(' '),
          )
        ) {
          return { stdout: '1024\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });
  const startedRecording = sessionStore.get(sessionName)?.recording;
  assert.equal(startedRecording?.platform, 'android');
  startedRecording?.gestureEvents.push({ kind: 'tap', tMs: 120, x: 90, y: 180 });

  const overlayCalls: Array<{ videoPath: string; telemetryPath: string }> = [];
  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        if (args.join(' ') === '-s emulator-5554 shell ps -o pid= -p 4321') {
          return { stdout: '', stderr: '', exitCode: 1 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            args.join(' '),
          )
        ) {
          return { stdout: '2048\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      overlayRecordingTouches: async ({ videoPath, telemetryPath }) => {
        overlayCalls.push({ videoPath, telemetryPath });
      },
    }),
  });

  assert.ok(adbCalls.some((args) => args.join(' ') === '-s emulator-5554 shell kill -2 4321'));
  assert.deepEqual(overlayCalls, [
    {
      videoPath: path.resolve('./android.mp4'),
      telemetryPath: deriveRecordingTelemetryPath(path.resolve('./android.mp4')),
    },
  ]);
});

test('record stop keeps Android video when overlay export fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-overlay-warning';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'device',
      booted: true,
    }),
  );

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android-warning.mp4'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        const command = args.join(' ');
        if (
          /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            command,
          )
        ) {
          return { stdout: '4321\n', stderr: '', exitCode: 0 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            command,
          )
        ) {
          return { stdout: '1024\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });

  const startedRecording = sessionStore.get(sessionName)?.recording;
  startedRecording?.gestureEvents.push({ kind: 'tap', tMs: 120, x: 90, y: 180 });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        const command = args.join(' ');
        if (command === '-s emulator-5554 shell ps -o pid= -p 4321') {
          return { stdout: '', stderr: '', exitCode: 1 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            command,
          )
        ) {
          return { stdout: '2048\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      overlayRecordingTouches: async () => {
        throw new Error('android overlay export failed');
      },
    }),
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(
    responseStop?.data?.overlayWarning,
    'failed to overlay recording touches: android overlay export failed',
  );
});

test('record stop force-kills Android screenrecord when SIGINT fails but process is still running', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-force-stop';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'device',
      booted: true,
    }),
  );

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        const command = args.join(' ');
        if (
          /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            command,
          )
        ) {
          return { stdout: '4321\n', stderr: '', exitCode: 0 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            command,
          )
        ) {
          return { stdout: '1024\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });

  const adbCalls: string[] = [];
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        const command = args.join(' ');
        adbCalls.push(command);
        if (command === '-s emulator-5554 shell kill -2 4321') {
          return { stdout: '', stderr: 'operation not permitted', exitCode: 1 };
        }
        if (command === '-s emulator-5554 shell ps -o pid= -p 4321') {
          return {
            stdout: adbCalls.includes('-s emulator-5554 shell kill -9 4321') ? '' : '4321\n',
            stderr: '',
            exitCode: 0,
          };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            command,
          )
        ) {
          return { stdout: '2048\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });

  assert.equal(response?.ok, true);
  assert.ok(adbCalls.includes('-s emulator-5554 shell kill -2 4321'));
  assert.ok(adbCalls.includes('-s emulator-5554 shell kill -9 4321'));
  assert.ok(
    adbCalls.some((command) =>
      /^-s emulator-5554 shell rm -f \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command),
    ),
  );
});

test('record stop reports invalidated recording after cleanup', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-invalidated-recording';
  const session = makeSession(sessionName, {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    booted: true,
  });
  session.recording = {
    platform: 'ios',
    outPath: path.resolve('./invalidated.mp4'),
    startedAt: Date.now() - 1_000,
    showTouches: true,
    gestureEvents: [],
    invalidatedReason: 'iOS runner session exited during recording',
    child: { kill: () => {} } as any,
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  };
  sessionStore.set(sessionName, session);

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    deps: makeRecordDeps(),
  });

  assert.equal(response?.ok, false);
  if (response?.ok === false) {
    assert.equal(response.error.code, 'COMMAND_FAILED');
    assert.equal(response.error.message, 'iOS runner session exited during recording');
  }
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record start leaves overlays disabled with --hide-touches', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-hide-touches';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    flags: { hideTouches: true },
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        if (
          /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            args.join(' '),
          )
        ) {
          return { stdout: '9999\n', stderr: '', exitCode: 0 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            args.join(' '),
          )
        ) {
          return { stdout: '1024\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });

  assert.equal(response?.ok, true);
  assert.equal(response?.data?.showTouches, false);
  assert.equal(sessionStore.get(sessionName)?.recording?.showTouches, false);
});

test('record start accepts Android screenrecord before the remote file begins growing', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-running-without-file-growth';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'device',
      booted: true,
    }),
  );

  let psChecks = 0;
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        const command = args.join(' ');
        if (
          /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            command,
          )
        ) {
          return { stdout: '5555\n', stderr: '', exitCode: 0 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(
            command,
          )
        ) {
          return { stdout: '0\n', stderr: '', exitCode: 0 };
        }
        if (command === '-s emulator-5554 shell ps -o pid= -p 5555') {
          psChecks += 1;
          return { stdout: '5555\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });

  assert.equal(response?.ok, true);
  assert.equal(psChecks >= 2, true);
});

test('record start falls back to /data/local/tmp when /sdcard is unavailable on Android', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-fallback-path';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Android',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    deps: makeRecordDeps({
      runCmd: async (_cmd, args) => {
        const command = args.join(' ');
        if (
          /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            command,
          )
        ) {
          return { stdout: 'permission denied\n', stderr: '', exitCode: 1 };
        }
        if (
          /^-s emulator-5554 shell screenrecord \/data\/local\/tmp\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
            command,
          )
        ) {
          return { stdout: '7777\n', stderr: '', exitCode: 0 };
        }
        if (
          /^-s emulator-5554 shell stat -c %s \/data\/local\/tmp\/agent-device-recording-\d+\.mp4$/.test(
            command,
          )
        ) {
          return { stdout: '1024\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
  });

  assert.equal(response?.ok, true);
  const recording = sessionStore.get(sessionName)?.recording;
  assert.equal(recording?.platform, 'android');
  assert.match(
    recording?.remotePath ?? '',
    /^\/data\/local\/tmp\/agent-device-recording-\d+\.mp4$/,
  );
});
