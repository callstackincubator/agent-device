import fs from 'node:fs';
import path from 'node:path';
import { resolveTargetDevice, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { SessionStore } from '../session-store.ts';
import type {
  DaemonArtifact,
  DaemonRequest,
  DaemonResponse,
  RecordingGestureEvent,
  SessionState,
} from '../types.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { runCmd, runCmdBackground } from '../../utils/exec.ts';
import { isPlayableVideo, waitForStableFile } from '../../utils/video.ts';
import {
  IOS_RUNNER_CONTAINER_BUNDLE_IDS,
  runIosRunnerCommand,
} from '../../platforms/ios/runner-client.ts';
import {
  overlayRecordingTouches,
  trimRecordingStart,
} from '../../platforms/ios/recording-overlay.ts';
import { buildSimctlArgsForDevice } from '../../platforms/ios/simctl.ts';
import { startAndroidRecording, stopAndroidRecording } from './record-trace-android.ts';

const IOS_DEVICE_RECORD_MIN_FPS = 1;
const IOS_DEVICE_RECORD_MAX_FPS = 120;

export type RecordTraceDeps = {
  runCmd: typeof runCmd;
  runCmdBackground: typeof runCmdBackground;
  runIosRunnerCommand: typeof runIosRunnerCommand;
  waitForStableFile: typeof waitForStableFile;
  isPlayableVideo: typeof isPlayableVideo;
  trimRecordingStart: typeof trimRecordingStart;
  overlayRecordingTouches: typeof overlayRecordingTouches;
};

export function buildRecordTraceDeps(overrides?: Partial<RecordTraceDeps>): RecordTraceDeps {
  return {
    runCmd,
    runCmdBackground,
    runIosRunnerCommand,
    waitForStableFile,
    isPlayableVideo,
    trimRecordingStart,
    overlayRecordingTouches,
    ...overrides,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedExecMessage(
  result: { stdout: string; stderr: string; exitCode: number },
  command: string,
): string {
  return (
    result.stderr.trim() || result.stdout.trim() || `${command} exited with code ${result.exitCode}`
  );
}

function isRunnerRecordingAlreadyInProgressError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('recording already in progress');
}

function normalizeAppBundleId(session: SessionState): string | undefined {
  const trimmed = session.appBundleId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function findOtherActiveIosRunnerRecording(
  sessionStore: SessionStore,
  deviceId: string,
  currentSessionName: string,
): SessionState | undefined {
  return sessionStore
    .toArray()
    .find(
      (session) =>
        session.name !== currentSessionName &&
        session.device.platform === 'ios' &&
        session.device.kind === 'device' &&
        session.device.id === deviceId &&
        session.recording?.platform === 'ios-device-runner',
    );
}

function getRunnerOptions(req: DaemonRequest, logPath: string | undefined, session: SessionState) {
  return {
    verbose: req.flags?.verbose,
    logPath,
    traceLogPath: session.trace?.outPath,
  };
}

function buildRecordingBase(
  req: DaemonRequest,
  outPath: string,
): {
  outPath: string;
  clientOutPath?: string;
  startedAt: number;
  showTouches: boolean;
  gestureEvents: RecordingGestureEvent[];
} {
  return {
    outPath,
    clientOutPath: req.meta?.clientArtifactPaths?.outPath,
    startedAt: Date.now(),
    showTouches: req.flags?.hideTouches !== true,
    gestureEvents: [],
  };
}

function resolveIosRecordingTrimStartMs(
  recording: Extract<NonNullable<SessionState['recording']>, { platform: 'ios-device-runner' }>,
): number {
  if (
    typeof recording.runnerStartedAtUptimeMs !== 'number' ||
    typeof recording.targetAppReadyUptimeMs !== 'number'
  ) {
    return 0;
  }
  return Math.max(0, recording.targetAppReadyUptimeMs - recording.runnerStartedAtUptimeMs);
}

async function startIosDeviceRecording(params: {
  req: DaemonRequest;
  activeSession: SessionState;
  sessionStore: SessionStore;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
  fpsFlag: number | undefined;
  recordingBase: ReturnType<typeof buildRecordingBase>;
  appBundleId: string;
}): Promise<DaemonResponse | NonNullable<SessionState['recording']>> {
  const {
    req,
    activeSession,
    sessionStore,
    device,
    logPath,
    deps,
    fpsFlag,
    recordingBase,
    appBundleId,
  } = params;
  const recordingFileName = `agent-device-recording-${Date.now()}.mp4`;
  const remotePath = `tmp/${recordingFileName}`;
  const runnerOptions = getRunnerOptions(req, logPath, activeSession);
  let runnerStartedAtUptimeMs: number | undefined;
  let targetAppReadyUptimeMs: number | undefined;
  const startRunnerRecording = async () =>
    deps.runIosRunnerCommand(
      device,
      {
        command: 'recordStart',
        outPath: recordingFileName,
        fps: fpsFlag,
        appBundleId,
      },
      runnerOptions,
    );

  try {
    const startResult = await startRunnerRecording();
    runnerStartedAtUptimeMs =
      typeof startResult.recorderStartUptimeMs === 'number'
        ? startResult.recorderStartUptimeMs
        : undefined;
    targetAppReadyUptimeMs =
      typeof startResult.targetAppReadyUptimeMs === 'number'
        ? startResult.targetAppReadyUptimeMs
        : undefined;
  } catch (error) {
    if (!isRunnerRecordingAlreadyInProgressError(error)) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `failed to start recording: ${errorMessage(error)}`,
        },
      };
    }

    emitDiagnostic({
      level: 'warn',
      phase: 'record_start_runner_desynced',
      data: {
        platform: device.platform,
        kind: device.kind,
        deviceId: device.id,
        session: activeSession.name,
        error: errorMessage(error),
      },
    });

    const otherRecordingSession = findOtherActiveIosRunnerRecording(
      sessionStore,
      device.id,
      activeSession.name,
    );
    if (otherRecordingSession) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `failed to start recording: recording already in progress in session '${otherRecordingSession.name}'`,
        },
      };
    }

    try {
      await deps.runIosRunnerCommand(device, { command: 'recordStop', appBundleId }, runnerOptions);
    } catch {
      // best effort: stop stale runner recording and retry start
    }

    try {
      const startResult = await startRunnerRecording();
      runnerStartedAtUptimeMs =
        typeof startResult.recorderStartUptimeMs === 'number'
          ? startResult.recorderStartUptimeMs
          : undefined;
      targetAppReadyUptimeMs =
        typeof startResult.targetAppReadyUptimeMs === 'number'
          ? startResult.targetAppReadyUptimeMs
          : undefined;
    } catch (retryError) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `failed to start recording: ${errorMessage(retryError)}`,
        },
      };
    }
  }

  return {
    platform: 'ios-device-runner',
    remotePath,
    runnerStartedAtUptimeMs,
    targetAppReadyUptimeMs,
    ...recordingBase,
  };
}

async function startRecording(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  activeSession: SessionState;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
}): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, activeSession, device, logPath, deps } = params;

  if (activeSession.recording) {
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: 'recording already in progress' },
    };
  }

  const fpsFlag = req.flags?.fps;
  if (
    fpsFlag !== undefined &&
    (!Number.isInteger(fpsFlag) ||
      fpsFlag < IOS_DEVICE_RECORD_MIN_FPS ||
      fpsFlag > IOS_DEVICE_RECORD_MAX_FPS)
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `fps must be an integer between ${IOS_DEVICE_RECORD_MIN_FPS} and ${IOS_DEVICE_RECORD_MAX_FPS}`,
      },
    };
  }

  if (!isCommandSupportedOnDevice('record', device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'record is not supported on this device',
      },
    };
  }

  const outPath = req.positionals?.[1] ?? `./recording-${Date.now()}.mp4`;
  const resolvedOut = SessionStore.expandHome(outPath, req.meta?.cwd);
  const recordingBase = buildRecordingBase(req, resolvedOut);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });

  let recording: NonNullable<SessionState['recording']> | DaemonResponse;
  if (device.platform === 'ios' && device.kind === 'device') {
    const appBundleId = normalizeAppBundleId(activeSession);
    if (!appBundleId) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message:
            'record on physical iOS devices requires an active app session; run open <app> first',
        },
      };
    }
    recording = await startIosDeviceRecording({
      req,
      activeSession,
      sessionStore,
      device,
      logPath,
      deps,
      fpsFlag,
      recordingBase,
      appBundleId,
    });
  } else if (device.platform === 'ios') {
    const { child, wait } = deps.runCmdBackground(
      'xcrun',
      buildSimctlArgsForDevice(device, ['io', device.id, 'recordVideo', resolvedOut]),
      {
        allowFailure: true,
      },
    );
    recording = { platform: 'ios', child, wait, ...recordingBase };
  } else {
    recording = await startAndroidRecording({ deps, device, recordingBase });
  }

  if ('ok' in recording) {
    return recording;
  }

  activeSession.recording = recording;
  sessionStore.set(sessionName, activeSession);
  sessionStore.recordAction(activeSession, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: (req.flags ?? {}) as CommandFlags,
    result: { action: 'start', showTouches: recording.showTouches },
  });

  return {
    ok: true,
    data: {
      recording: 'started',
      outPath: recording.clientOutPath ?? outPath,
      showTouches: recording.showTouches,
    },
  };
}

async function stopIosDeviceRecording(params: {
  req: DaemonRequest;
  activeSession: SessionState;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
  recording: Extract<NonNullable<SessionState['recording']>, { platform: 'ios-device-runner' }>;
}): Promise<DaemonResponse | null> {
  const { req, activeSession, device, logPath, deps, recording } = params;
  const appBundleId = normalizeAppBundleId(activeSession);

  try {
    await deps.runIosRunnerCommand(
      device,
      { command: 'recordStop', appBundleId },
      getRunnerOptions(req, logPath, activeSession),
    );
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'record_stop_runner_failed',
      data: {
        platform: device.platform,
        kind: device.kind,
        deviceId: device.id,
        session: activeSession.name,
        error: errorMessage(error),
      },
    });
    // best effort: clear runner-backed recording state even if runner stop fails
  }

  let copyResult = { stdout: '', stderr: '', exitCode: 1 };
  for (const bundleId of IOS_RUNNER_CONTAINER_BUNDLE_IDS) {
    copyResult = await deps.runCmd(
      'xcrun',
      [
        'devicectl',
        'device',
        'copy',
        'from',
        '--device',
        device.id,
        '--source',
        recording.remotePath,
        '--destination',
        recording.outPath,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        bundleId,
      ],
      { allowFailure: true },
    );
    if (copyResult.exitCode === 0) {
      break;
    }
  }

  if (copyResult.exitCode !== 0) {
    const copyError =
      copyResult.stderr.trim() ||
      copyResult.stdout.trim() ||
      `devicectl exited with code ${copyResult.exitCode}`;
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `failed to copy recording from device: ${copyError}`,
      },
    };
  }

  const trimStartMs = resolveIosRecordingTrimStartMs(recording);
  if (trimStartMs > 0) {
    await deps.trimRecordingStart({
      videoPath: recording.outPath,
      trimStartMs,
    });
  }

  if (recording.showTouches) {
    await deps.overlayRecordingTouches({
      videoPath: recording.outPath,
      events: recording.gestureEvents,
      targetLabel: 'iOS recording',
    });
  }

  return null;
}

async function stopNonRunnerRecording(params: {
  deps: RecordTraceDeps;
  device: SessionState['device'];
  recording: Exclude<NonNullable<SessionState['recording']>, { platform: 'ios-device-runner' }>;
}): Promise<DaemonResponse | null> {
  const { deps, device, recording } = params;
  if (recording.platform === 'android') {
    return await stopAndroidRecording({ deps, device, recording });
  }

  recording.child.kill('SIGINT');

  const stopResult = await recording.wait;
  if (stopResult.exitCode !== 0) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `failed to stop recording: ${failedExecMessage(stopResult, 'simctl recordVideo')}`,
      },
    };
  }

  if (recording.showTouches) {
    await deps.overlayRecordingTouches({
      videoPath: recording.outPath,
      events: recording.gestureEvents,
      targetLabel: 'iOS recording',
    });
  }

  return null;
}

async function stopRecording(params: {
  req: DaemonRequest;
  activeSession: SessionState;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
}): Promise<DaemonResponse> {
  const { req, activeSession, device, logPath, deps } = params;

  if (!activeSession.recording) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active recording' } };
  }

  const recording = activeSession.recording;
  activeSession.recording = undefined;

  const stopError =
    recording.platform === 'ios-device-runner'
      ? await stopIosDeviceRecording({ req, activeSession, device, logPath, deps, recording })
      : await stopNonRunnerRecording({ deps, device, recording });
  if (stopError) {
    return stopError;
  }

  return buildRecordStopResponse(recording);
}

function buildRecordStopResponse(
  recording: NonNullable<SessionState['recording']>,
): DaemonResponse {
  const artifacts: DaemonArtifact[] = [
    {
      field: 'outPath',
      path: recording.outPath,
      localPath: recording.clientOutPath,
      fileName: path.basename(recording.clientOutPath ?? recording.outPath),
    },
  ];

  return {
    ok: true,
    data: {
      recording: 'stopped',
      outPath: recording.outPath,
      artifacts,
      showTouches: recording.showTouches,
    },
  };
}

export async function handleRecordCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  logPath?: string;
  deps?: Partial<RecordTraceDeps>;
}): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, logPath } = params;
  const deps = buildRecordTraceDeps(params.deps);
  const session = sessionStore.get(sessionName);
  const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
  if (!session) {
    await ensureDeviceReady(device);
  }

  const activeSession =
    session ??
    ({
      name: sessionName,
      device,
      createdAt: Date.now(),
      actions: [],
    } satisfies SessionState);

  const action = (req.positionals?.[0] ?? '').toLowerCase();
  if (!['start', 'stop'].includes(action)) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'record requires start|stop' } };
  }

  if (action === 'start') {
    return startRecording({ req, sessionName, sessionStore, activeSession, device, logPath, deps });
  }

  const response = await stopRecording({ req, activeSession, device, logPath, deps });
  if (!response.ok) {
    return response;
  }

  sessionStore.recordAction(activeSession, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: (req.flags ?? {}) as CommandFlags,
    result: {
      action: 'stop',
      outPath: response.data?.outPath,
      showTouches: response.data?.showTouches,
    },
  });
  return response;
}
