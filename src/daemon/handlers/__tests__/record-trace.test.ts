import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../utils/exec.ts', () => ({
  runCmd: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  runCmdBackground: vi.fn(() => ({
    child: { kill: vi.fn() },
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  })),
}));

vi.mock('../../../platforms/ios/runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/ios/runner-client.ts')>();
  return {
    ...actual,
    runIosRunnerCommand: vi.fn(async () => ({})),
  };
});

vi.mock('../../../utils/video.ts', () => ({
  waitForStableFile: vi.fn(async () => {}),
  isPlayableVideo: vi.fn(async () => true),
}));

vi.mock('../../../recording/overlay.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../recording/overlay.ts')>();
  return {
    ...actual,
    trimRecordingStart: vi.fn(async () => {}),
    overlayRecordingTouches: vi.fn(async () => {}),
  };
});

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return {
    ...actual,
    resolveTargetDevice: vi.fn(async () => {
      throw new Error('resolveTargetDevice should not run');
    }),
  };
});

vi.mock('../../device-ready.ts', () => ({
  ensureDeviceReady: vi.fn(async () => {}),
}));

import { handleRecordTraceCommands } from '../record-trace.ts';
import { deriveRecordingTelemetryPath } from '../../recording-telemetry.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import { IOS_RUNNER_CONTAINER_BUNDLE_IDS } from '../../../platforms/ios/runner-client.ts';
import { getRecordingOverlaySupportWarning } from '../../../recording/overlay.ts';
import { runCmd } from '../../../utils/exec.ts';
import { runCmdBackground } from '../../../utils/exec.ts';
import { runIosRunnerCommand } from '../../../platforms/ios/runner-client.ts';
import { trimRecordingStart, overlayRecordingTouches } from '../../../recording/overlay.ts';

type RunnerCall = {
  command: string;
  outPath?: string;
  fps?: number;
  appBundleId?: string;
  logPath?: string;
  traceLogPath?: string;
};

const mockRunCmd = vi.mocked(runCmd);
const mockRunCmdBackground = vi.mocked(runCmdBackground);
const mockRunIosRunnerCommand = vi.mocked(runIosRunnerCommand);
const mockTrimRecordingStart = vi.mocked(trimRecordingStart);
const mockOverlayRecordingTouches = vi.mocked(overlayRecordingTouches);

const overlaySupportWarning = getRecordingOverlaySupportWarning();

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
  });
}

function setupRunnerRecordingMocks(
  runnerCalls: RunnerCall[],
  runCmdCalls: Array<{ cmd: string; args: string[] }>,
): void {
  mockRunIosRunnerCommand.mockImplementation(async (_device, command, options) => {
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
  });
  mockRunCmd.mockImplementation(async (cmd, args) => {
    runCmdCalls.push({ cmd, args });
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for runner-backed recording');
  });
}

function setupDefaultMocks(
  overrides: {
    runCmd?: typeof runCmd;
    runCmdBackground?: typeof runCmdBackground;
    runIosRunnerCommand?: typeof runIosRunnerCommand;
    trimRecordingStart?: typeof trimRecordingStart;
    overlayRecordingTouches?: typeof overlayRecordingTouches;
  } = {},
): void {
  if (overrides.runCmd) {
    mockRunCmd.mockImplementation(overrides.runCmd as any);
  }
  if (overrides.runCmdBackground) {
    mockRunCmdBackground.mockImplementation(overrides.runCmdBackground as any);
  }
  if (overrides.runIosRunnerCommand) {
    mockRunIosRunnerCommand.mockImplementation(overrides.runIosRunnerCommand as any);
  }
  if (overrides.trimRecordingStart) {
    mockTrimRecordingStart.mockImplementation(overrides.trimRecordingStart as any);
  }
  if (overrides.overlayRecordingTouches) {
    mockOverlayRecordingTouches.mockImplementation(overrides.overlayRecordingTouches as any);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default implementations
  mockRunCmd.mockImplementation(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used in this test');
  });
  mockRunIosRunnerCommand.mockImplementation(async () => ({}));
  mockTrimRecordingStart.mockImplementation(async () => {});
  mockOverlayRecordingTouches.mockImplementation(async () => {});
});

test('record start/stop uses iOS runner on physical iOS devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  setupRunnerRecordingMocks(runnerCalls, runCmdCalls);
  const finalOut = path.join(os.tmpdir(), `agent-device-test-record-${Date.now()}.mp4`);
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', finalOut],
    logPath: '/tmp/daemon.log',
  });

  expect(responseStart).toBeTruthy();
  expect(responseStart?.ok).toBe(true);
  expect(runnerCalls.length).toBe(1);
  expect(runnerCalls[0]?.command).toBe('recordStart');
  expect(runnerCalls[0]?.outPath ?? '').toMatch(/^agent-device-recording-\d+\.mp4$/);
  expect(runnerCalls[0]?.fps).toBeUndefined();
  expect(runnerCalls[0]?.appBundleId).toBe('com.atebits.Tweetie2');
  expect(runnerCalls[0]?.logPath).toBe('/tmp/daemon.log');
  expect(runnerCalls[0]?.traceLogPath).toBeUndefined();
  expect(responseStart?.ok).toBe(true);
  expect((responseStart as any).data?.showTouches).toBe(true);
  const startedRecording = sessionStore.get(sessionName)?.recording;
  expect(startedRecording?.platform).toBe('ios-device-runner');
  const stagedRemotePath =
    startedRecording && startedRecording.platform === 'ios-device-runner'
      ? startedRecording.remotePath
      : undefined;
  expect(stagedRemotePath ?? '').toMatch(/^tmp\/agent-device-recording-\d+\.mp4$/);
  if (startedRecording?.platform === 'ios-device-runner') {
    expect(startedRecording.runnerStartedAtUptimeMs).toBe(12_345);
    expect(startedRecording.targetAppReadyUptimeMs).toBe(15_678);
    expect(startedRecording.showTouches).toBe(true);
  }

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    logPath: '/tmp/daemon.log',
  });

  expect(responseStop).toBeTruthy();
  expect(responseStop?.ok).toBe(true);
  expect(runnerCalls.length).toBe(2);
  expect(runnerCalls[1]?.command).toBe('recordStop');
  expect(runnerCalls[1]?.appBundleId).toBe('com.atebits.Tweetie2');
  expect(runCmdCalls.length).toBe(1);
  expect(runCmdCalls[0]?.cmd).toBe('xcrun');
  expect(runCmdCalls[0]?.args).toEqual([
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
  expect(responseStop?.ok).toBe(true);
  expect((responseStop as any).data?.telemetryPath).toBe(deriveRecordingTelemetryPath(finalOut));
  expect((responseStop as any).data?.artifacts?.map((artifact: any) => artifact.field)).toEqual([
    'outPath',
    'telemetryPath',
  ]);
  expect((responseStop as any).data?.artifacts?.[1]?.path).toBe(
    deriveRecordingTelemetryPath(finalOut),
  );
  expect(sessionStore.get(sessionName)?.recording).toBeUndefined();
});

test('record start/stop uses runner on macOS desktop sessions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-runner';
  sessionStore.set(sessionName, makeMacOsSession(sessionName, 'com.apple.systempreferences'));

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  setupRunnerRecordingMocks(runnerCalls, runCmdCalls);
  const finalOut = path.join(os.tmpdir(), `agent-device-test-macos-record-${Date.now()}.mp4`);
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', finalOut],
    logPath: '/tmp/daemon.log',
  });

  expect(responseStart?.ok).toBe(true);
  expect(runnerCalls.length).toBe(1);
  expect(runnerCalls[0]).toEqual({
    command: 'recordStart',
    outPath: finalOut,
    fps: undefined,
    appBundleId: 'com.apple.systempreferences',
    logPath: '/tmp/daemon.log',
    traceLogPath: undefined,
  });
  expect(sessionStore.get(sessionName)?.recording?.platform).toBe('macos-runner');
  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    logPath: '/tmp/daemon.log',
  });

  expect(responseStop?.ok).toBe(true);
  expect(runnerCalls.length).toBe(2);
  expect(runnerCalls[1]?.command).toBe('recordStop');
  expect(runnerCalls[1]?.appBundleId).toBe('com.apple.systempreferences');
  expect(runCmdCalls.length).toBe(0);
  expect(sessionStore.get(sessionName)?.recording).toBeUndefined();
});

test('record stop derives telemetry artifact local path from client outPath', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-remote-artifacts';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  setupRunnerRecordingMocks(runnerCalls, runCmdCalls);
  const finalOut = path.join(os.tmpdir(), `agent-device-test-record-${Date.now()}.mp4`);

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', finalOut],
    clientArtifactPaths: { outPath: finalOut },
  });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(responseStop?.ok).toBe(true);
  expect((responseStop as any).data?.artifacts?.[1]?.field).toBe('telemetryPath');
  expect((responseStop as any).data?.artifacts?.[1]?.localPath).toBe(
    deriveRecordingTelemetryPath(finalOut),
  );
  expect((responseStop as any).data?.telemetryPath).toBe(deriveRecordingTelemetryPath(finalOut));
});

test('record start resolves relative output path from request cwd', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-cwd';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  setupRunnerRecordingMocks(runnerCalls, runCmdCalls);
  const cwd = '/tmp/agent-device-cwd-test';
  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    cwd,
  });

  expect(responseStart?.ok).toBe(true);
  expect(runnerCalls[0]?.outPath ?? '').toMatch(/^agent-device-recording-\d+\.mp4$/);
  expect(runnerCalls[0]?.fps).toBeUndefined();
  const startedRecording = sessionStore.get(sessionName)?.recording;
  expect(startedRecording?.platform).toBe('ios-device-runner');
  if (startedRecording?.platform === 'ios-device-runner') {
    expect(startedRecording.outPath).toBe(path.join(cwd, 'device.mp4'));
    expect(startedRecording.remotePath ?? '').toMatch(/^tmp\/agent-device-recording-\d+\.mp4$/);
  }

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
    cwd,
  });
  expect(runCmdCalls.length).toBe(1);
});

test('record start forwards explicit fps to iOS runner', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-fps';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const runnerCalls: RunnerCall[] = [];
  const runCmdCalls: Array<{ cmd: string; args: string[] }> = [];
  setupRunnerRecordingMocks(runnerCalls, runCmdCalls);
  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    flags: { fps: 30 },
  });

  expect(response?.ok).toBe(true);
  expect(runnerCalls[0]?.command).toBe('recordStart');
  expect(runnerCalls[0]?.fps).toBe(30);
  expect(runCmdCalls.length).toBe(0);
});

test('record start rejects invalid fps value', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-invalid-fps';
  sessionStore.set(sessionName, makeIosDeviceSession(sessionName));

  mockRunIosRunnerCommand.mockImplementation(async () => {
    throw new Error('runIosRunnerCommand should not be used for invalid args');
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for invalid args');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
    flags: { fps: 0 },
  });

  expect(response?.ok).toBe(false);
  expect((response as any).error?.code).toBe('INVALID_ARGS');
  expect((response as any).error?.message ?? '').toMatch(
    /fps must be an integer between 1 and 120/,
  );
});

test('record start on iOS device requires active app session context', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-no-app';
  sessionStore.set(sessionName, makeIosDeviceSession(sessionName));

  mockRunIosRunnerCommand.mockImplementation(async () => {
    throw new Error('runIosRunnerCommand should not be used without active app context');
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for iOS devices');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
  });

  expect(response?.ok).toBe(false);
  expect((response as any).error?.code).toBe('INVALID_ARGS');
  expect((response as any).error?.message ?? '').toMatch(/requires an active app session/i);
});

test('record start returns structured error when iOS runner start fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-start-fail';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  mockRunIosRunnerCommand.mockImplementation(async () => {
    throw new Error('runner disconnected');
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for iOS devices');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
  });

  expect(response?.ok).toBe(false);
  expect((response as any).error?.code).toBe('COMMAND_FAILED');
  expect((response as any).error?.message ?? '').toMatch(
    /failed to start recording: runner disconnected/,
  );
  expect(sessionStore.get(sessionName)?.recording).toBeUndefined();
});

test('record start recovers from stale iOS runner recording state', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-runner-desync';
  const session = makeIosDeviceSession(sessionName, 'com.atebits.Tweetie2');
  sessionStore.set(sessionName, session);

  const commands: string[] = [];
  let startAttempts = 0;
  mockRunIosRunnerCommand.mockImplementation(async (_device, command) => {
    commands.push(command.command);
    if (command.command === 'recordStart') {
      startAttempts += 1;
      if (startAttempts === 1) {
        throw new Error('recording already in progress');
      }
    }
    return { recorderStartUptimeMs: 11_000, targetAppReadyUptimeMs: 12_000 };
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for iOS devices');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
  });

  expect(response?.ok).toBe(true);
  expect(commands).toEqual(['recordStart', 'recordStop', 'recordStart']);
  expect(sessionStore.get(sessionName)?.recording?.platform).toBe('ios-device-runner');
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
  mockRunIosRunnerCommand.mockImplementation(async (_device, command) => {
    commands.push(command.command);
    if (command.command === 'recordStart') {
      throw new Error('recording already in progress');
    }
    return {};
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for iOS devices');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './device.mp4'],
  });

  expect(response?.ok).toBe(false);
  expect((response as any).error?.code).toBe('COMMAND_FAILED');
  expect((response as any).error?.message ?? '').toMatch(
    /already in progress in session 'ios-device-owner'/,
  );
  expect(commands).toEqual(['recordStart']);
  expect(sessionStore.get(ownerSessionName)?.recording?.platform).toBe('ios-device-runner');
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
  mockRunCmd.mockImplementation(async (cmd, args) => {
    runCmdCalls.push({ cmd, args });
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  mockRunIosRunnerCommand.mockImplementation(async () => {
    throw new Error('runner disconnected');
  });
  mockRunCmdBackground.mockImplementation(() => {
    throw new Error('runCmdBackground should not be used for iOS devices');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(response?.ok).toBe(true);
  expect((response as any).data?.recording).toBe('stopped');
  expect(runCmdCalls.length).toBe(1);
  expect(sessionStore.get(sessionName)?.recording).toBeUndefined();
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
  mockTrimRecordingStart.mockImplementation(async ({ videoPath, trimStartMs }) => {
    lifecycleCalls.push(`trim:${videoPath}:${trimStartMs}`);
  });
  mockOverlayRecordingTouches.mockImplementation(async ({ videoPath, telemetryPath }) => {
    lifecycleCalls.push(`overlay:${videoPath}:${telemetryPath}`);
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(response?.ok).toBe(true);
  const expectedLifecycleCalls = ['trim:/tmp/device.mp4:3250'];
  if (!overlaySupportWarning) {
    expectedLifecycleCalls.push(
      `overlay:/tmp/device.mp4:${deriveRecordingTelemetryPath('/tmp/device.mp4')}`,
    );
  }
  expect(lifecycleCalls).toEqual(expectedLifecycleCalls);
  expect((response as any).data?.overlayWarning).toBe(overlaySupportWarning);
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
  mockRunCmdBackground.mockImplementation((cmd, args) => {
    expect(cmd).toBe('xcrun');
    expect(args.slice(0, 4)).toEqual(['simctl', 'io', 'sim-1', 'recordVideo']);
    expect(args[4]).toBe(path.resolve('./sim.mp4'));
    started = true;
    return {
      child: {
        kill: () => {
          stopped = true;
        },
      } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    };
  });

  const responseStart = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './sim.mp4'],
  });

  expect(responseStart?.ok).toBe(true);
  expect(started).toBe(true);

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(responseStop?.ok).toBe(true);
  expect(stopped).toBe(true);
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

  mockRunCmdBackground.mockImplementation(() => ({
    child: { kill: () => {} } as any,
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  }));
  mockOverlayRecordingTouches.mockImplementation(async () => {
    throw new Error('swift export failed');
  });

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './sim-warning.mp4'],
  });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(responseStop?.ok).toBe(true);
  expect((responseStop as any).data?.overlayWarning).toBe(
    overlaySupportWarning ?? 'failed to overlay recording touches: swift export failed',
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
  mockRunCmdBackground.mockImplementation(() => {
    started = true;
    return {
      child: { kill: () => {} } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    };
  });
  mockRunIosRunnerCommand.mockImplementation(async () => {
    throw new Error('runner warm-up unavailable');
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './sim.mp4'],
  });

  expect(response?.ok).toBe(true);
  expect(started).toBe(true);
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
  mockRunCmd.mockImplementation(async (_cmd, args) => {
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
  });

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
  });
  const startedRecording = sessionStore.get(sessionName)?.recording;
  expect(startedRecording?.platform).toBe('android');
  startedRecording?.gestureEvents.push({ kind: 'tap', tMs: 120, x: 90, y: 180 });

  const overlayCalls: Array<{ videoPath: string; telemetryPath: string }> = [];
  mockRunCmd.mockImplementation(async (_cmd, args) => {
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
  });
  mockOverlayRecordingTouches.mockImplementation(async ({ videoPath, telemetryPath }) => {
    overlayCalls.push({ videoPath, telemetryPath });
  });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(adbCalls.some((args) => args.join(' ') === '-s emulator-5554 shell kill -2 4321')).toBe(
    true,
  );
  expect(responseStop?.ok).toBe(true);
  if (!responseStop?.ok) {
    throw new Error('expected successful Android record stop response');
  }
  if (overlaySupportWarning) {
    expect(overlayCalls).toEqual([]);
    expect(responseStop.data?.overlayWarning).toBe(overlaySupportWarning);
  } else {
    expect(overlayCalls).toEqual([
      {
        videoPath: path.resolve('./android.mp4'),
        telemetryPath: deriveRecordingTelemetryPath(path.resolve('./android.mp4')),
      },
    ]);
    expect(responseStop.data?.overlayWarning).toBeUndefined();
  }
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

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    const command = args.join(' ');
    if (
      /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
        command,
      )
    ) {
      return { stdout: '4321\n', stderr: '', exitCode: 0 };
    }
    if (
      /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command)
    ) {
      return { stdout: '1024\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android-warning.mp4'],
  });

  const startedRecording = sessionStore.get(sessionName)?.recording;
  startedRecording?.gestureEvents.push({ kind: 'tap', tMs: 120, x: 90, y: 180 });

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    const command = args.join(' ');
    if (command === '-s emulator-5554 shell ps -o pid= -p 4321') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }
    if (
      /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command)
    ) {
      return { stdout: '2048\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  mockOverlayRecordingTouches.mockImplementation(async () => {
    throw new Error('android overlay export failed');
  });

  const responseStop = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(responseStop?.ok).toBe(true);
  expect((responseStop as any).data?.overlayWarning).toBe(
    overlaySupportWarning ?? 'failed to overlay recording touches: android overlay export failed',
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

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    const command = args.join(' ');
    if (
      /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
        command,
      )
    ) {
      return { stdout: '4321\n', stderr: '', exitCode: 0 };
    }
    if (
      /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command)
    ) {
      return { stdout: '1024\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
  });

  const adbCalls: string[] = [];
  mockRunCmd.mockImplementation(async (_cmd, args) => {
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
      /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command)
    ) {
      return { stdout: '2048\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['stop'],
  });

  expect(response?.ok).toBe(true);
  expect(adbCalls.includes('-s emulator-5554 shell kill -2 4321')).toBe(true);
  expect(adbCalls.includes('-s emulator-5554 shell kill -9 4321')).toBe(true);
  expect(
    adbCalls.some((command) =>
      /^-s emulator-5554 shell rm -f \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command),
    ),
  ).toBe(true);
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
  });

  expect(response?.ok).toBe(false);
  if (response?.ok === false) {
    expect(response.error.code).toBe('COMMAND_FAILED');
    expect(response.error.message).toBe('iOS runner session exited during recording');
  }
  expect(sessionStore.get(sessionName)?.recording).toBeUndefined();
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

  mockRunCmd.mockImplementation(async (_cmd, args) => {
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
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
    flags: { hideTouches: true },
  });

  expect(response?.ok).toBe(true);
  expect((response as any).data?.showTouches).toBe(false);
  expect(sessionStore.get(sessionName)?.recording?.showTouches).toBe(false);
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
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    const command = args.join(' ');
    if (
      /^-s emulator-5554 shell screenrecord \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
        command,
      )
    ) {
      return { stdout: '5555\n', stderr: '', exitCode: 0 };
    }
    if (
      /^-s emulator-5554 shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command)
    ) {
      return { stdout: '0\n', stderr: '', exitCode: 0 };
    }
    if (command === '-s emulator-5554 shell ps -o pid= -p 5555') {
      psChecks += 1;
      return { stdout: '5555\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
  });

  expect(response?.ok).toBe(true);
  expect(psChecks >= 2).toBe(true);
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

  mockRunCmd.mockImplementation(async (_cmd, args) => {
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
  });

  const response = await runRecordCommand({
    sessionStore,
    sessionName,
    positionals: ['start', './android.mp4'],
  });

  expect(response?.ok).toBe(true);
  const recording = sessionStore.get(sessionName)?.recording;
  expect(recording?.platform).toBe('android');
  expect(recording?.remotePath ?? '').toMatch(
    /^\/data\/local\/tmp\/agent-device-recording-\d+\.mp4$/,
  );
});
