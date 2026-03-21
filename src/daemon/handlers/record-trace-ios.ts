import { SessionStore } from '../session-store.ts';
import type {
  DaemonRequest,
  DaemonResponse,
  RecordingGestureEvent,
  SessionState,
} from '../types.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { persistRecordingTelemetry } from '../recording-telemetry.ts';
import { IOS_RUNNER_CONTAINER_BUNDLE_IDS } from '../../platforms/ios/runner-client.ts';
import { formatRecordTraceError } from '../record-trace-errors.ts';
import type { RecordTraceDeps } from './record-trace-recording.ts';

type RecordingBase = {
  outPath: string;
  clientOutPath?: string;
  startedAt: number;
  showTouches: boolean;
  gestureEvents: RecordingGestureEvent[];
};

export function normalizeAppBundleId(session: SessionState): string | undefined {
  const trimmed = session.appBundleId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isRunnerRecordingAlreadyInProgressError(error: unknown): boolean {
  return formatRecordTraceError(error).toLowerCase().includes('recording already in progress');
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

export async function warmIosSimulatorRunner(params: {
  req: DaemonRequest;
  activeSession: SessionState;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
}): Promise<void> {
  const { req, activeSession, device, logPath, deps } = params;
  const appBundleId = normalizeAppBundleId(activeSession);
  if (!appBundleId) return;

  try {
    await deps.runIosRunnerCommand(
      device,
      {
        command: 'snapshot',
        appBundleId,
        interactiveOnly: true,
        compact: true,
        depth: 1,
      },
      getRunnerOptions(req, logPath, activeSession),
    );
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'record_start_simulator_runner_warm_failed',
      data: {
        deviceId: device.id,
        session: activeSession.name,
        appBundleId,
        error: formatRecordTraceError(error),
      },
    });
  }
}

export async function startIosDeviceRecording(params: {
  req: DaemonRequest;
  activeSession: SessionState;
  sessionStore: SessionStore;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
  fpsFlag: number | undefined;
  recordingBase: RecordingBase;
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
          message: `failed to start recording: ${formatRecordTraceError(error)}`,
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
        error: formatRecordTraceError(error),
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
          message: `failed to start recording: ${formatRecordTraceError(retryError)}`,
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

export async function stopIosDeviceRecording(params: {
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
        error: formatRecordTraceError(error),
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

  const telemetryPath = persistRecordingTelemetry({
    recording,
    trimStartMs,
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
