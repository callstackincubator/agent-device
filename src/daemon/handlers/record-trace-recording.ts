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
import { runCmd, runCmdBackground } from '../../utils/exec.ts';
import { isPlayableVideo, waitForStableFile } from '../../utils/video.ts';
import {
  deriveRecordingTelemetryPath,
  persistRecordingTelemetry,
  writeRecordingTelemetry,
} from '../recording-telemetry.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import {
  overlayRecordingTouches,
  trimRecordingStart,
} from '../../platforms/ios/recording-overlay.ts';
import { buildSimctlArgsForDevice } from '../../platforms/ios/simctl.ts';
import { formatRecordTraceExecFailure } from '../record-trace-errors.ts';
import { startAndroidRecording, stopAndroidRecording } from './record-trace-android.ts';
import {
  normalizeAppBundleId,
  startIosDeviceRecording,
  stopIosDeviceRecording,
  warmIosSimulatorRunner,
} from './record-trace-ios.ts';

const IOS_DEVICE_RECORD_MIN_FPS = 1;
const IOS_DEVICE_RECORD_MAX_FPS = 120;

export type RecordTraceDeps = {
  runCmd: typeof runCmd;
  runCmdBackground: typeof runCmdBackground;
  runIosRunnerCommand: typeof runIosRunnerCommand;
  waitForStableFile: typeof waitForStableFile;
  isPlayableVideo: typeof isPlayableVideo;
  writeRecordingTelemetry: typeof writeRecordingTelemetry;
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
    writeRecordingTelemetry,
    trimRecordingStart,
    overlayRecordingTouches,
    ...overrides,
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
  fs.rmSync(resolvedOut, { force: true });

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
    await warmIosSimulatorRunner({
      req,
      activeSession,
      device,
      logPath,
      deps,
    });
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
        message: `failed to stop recording: ${formatRecordTraceExecFailure(stopResult, 'simctl recordVideo')}`,
      },
    };
  }

  const telemetryPath = persistRecordingTelemetry({
    recording,
    writeTelemetry: deps.writeRecordingTelemetry,
  });

  if (recording.showTouches) {
    await deps.overlayRecordingTouches({
      videoPath: recording.outPath,
      telemetryPath,
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
  if (recording.telemetryPath) {
    artifacts.push({
      field: 'telemetryPath',
      path: recording.telemetryPath,
      localPath: deriveClientTelemetryPath(recording),
      fileName: path.basename(recording.telemetryPath),
    });
  }

  return {
    ok: true,
    data: {
      recording: 'stopped',
      outPath: recording.outPath,
      telemetryPath: recording.telemetryPath,
      artifacts,
      showTouches: recording.showTouches,
    },
  };
}

function deriveClientTelemetryPath(
  recording: NonNullable<SessionState['recording']>,
): string | undefined {
  if (!recording.clientOutPath) {
    return undefined;
  }
  return deriveRecordingTelemetryPath(recording.clientOutPath);
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
