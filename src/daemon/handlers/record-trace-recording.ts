import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../../utils/timeouts.ts';
import { resolveTargetDevice, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { SessionStore } from '../session-store.ts';
import type { DaemonArtifact, DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { runCmd, type ExecResult } from '../../utils/exec.ts';
import { isPlayableVideo, waitForStableFile } from '../../utils/video.ts';
import { deriveRecordingTelemetryPath } from '../recording-telemetry.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import { runXcrun } from '../../platforms/ios/tool-provider.ts';
import {
  overlayRecordingTouches,
  resizeRecording,
  trimRecordingStart,
} from '../../recording/overlay.ts';
import { formatRecordTraceError, formatRecordTraceExecFailure } from '../record-trace-errors.ts';
import { resolveRecordingProvider } from '../recording-provider.ts';
import { finalizeRecordingOverlay } from './record-trace-finalize.ts';
import { errorResponse } from './response.ts';
import { startAndroidRecording, stopAndroidRecording } from './record-trace-android.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../../utils/diagnostics.ts';
import {
  getIosRunnerOptions,
  normalizeAppBundleId,
  startIosDeviceRecording,
  startMacOsRecording,
  stopMacOsRecording,
  stopIosDeviceRecording,
  warmIosSimulatorRunner,
} from './record-trace-ios.ts';

const IOS_DEVICE_RECORD_MIN_FPS = 1;
const IOS_DEVICE_RECORD_MAX_FPS = 120;
const RECORDING_MIN_QUALITY = 5;
const RECORDING_MAX_QUALITY = 10;
const LOCAL_RECORDING_READY_POLL_MS = 250;
const LOCAL_RECORDING_READY_SETTLE_POLLS = 2;
const IOS_SIMULATOR_RECORDING_TAIL_SETTLE_MS = 350;
const IOS_SIMULATOR_RECORDING_STOP_TIMEOUT_MS = 5_000;
const IOS_SIMULATOR_RECORDING_FORCE_STOP_TIMEOUT_MS = 2_000;
const IOS_SIMULATOR_VIDEO_READY_POLL_MS = 150;
const IOS_SIMULATOR_VIDEO_READY_ATTEMPTS = 12;

import type { RecordTraceDeps, RecordingBase } from './record-trace-types.ts';

export type { RecordTraceDeps, RecordingBase } from './record-trace-types.ts';

function buildRecordTraceDeps(): RecordTraceDeps {
  return {
    runCmd: async (cmd, args, options) =>
      cmd === 'xcrun' ? await runXcrun(args, options) : await runCmd(cmd, args, options),
    startIosSimulatorRecording: (request) =>
      resolveRecordingProvider().startIosSimulatorRecording(request),
    runIosRunnerCommand,
    waitForRecordingTail,
    waitForStableFile,
    isPlayableVideo,
    trimRecordingStart,
    resizeRecording,
    overlayRecordingTouches,
  };
}

async function waitForRecordingTail(
  recording: RecordingBase & { platform: 'ios' | 'android' },
): Promise<void> {
  if (recording.platform !== 'ios') return;
  if (recording.gestureEvents.length === 0) return;
  await sleep(IOS_SIMULATOR_RECORDING_TAIL_SETTLE_MS);
}

function buildRecordingBase(req: DaemonRequest, outPath: string): RecordingBase {
  return {
    outPath,
    clientOutPath: req.meta?.clientArtifactPaths?.outPath,
    startedAt: Date.now(),
    quality: req.flags?.quality,
    showTouches: req.flags?.hideTouches !== true,
    gestureEvents: [],
  };
}

async function waitForLocalRecordingSettleWindow(outPath: string): Promise<number> {
  // simctl recordVideo can take a beat to open its output even though recording has already
  // started. This is a short settle window, not a strict readiness guarantee. We prefer a
  // close recorder anchor over blocking start indefinitely waiting for non-zero bytes.
  for (let attempt = 0; attempt < LOCAL_RECORDING_READY_SETTLE_POLLS; attempt += 1) {
    try {
      const stat = fs.statSync(outPath);
      if (stat.size > 0) {
        return Date.now();
      }
    } catch {
      // Wait for the recorder to create the output file.
    }

    if (attempt + 1 >= LOCAL_RECORDING_READY_SETTLE_POLLS) {
      return Date.now();
    }

    await sleep(LOCAL_RECORDING_READY_POLL_MS);
  }

  return Date.now();
}

// --- Per-platform start helpers ---

async function startIosSimulatorRecording(params: {
  req: DaemonRequest;
  activeSession: SessionState;
  device: SessionState['device'];
  logPath?: string;
  deps: RecordTraceDeps;
  recordingBase: RecordingBase;
  resolvedOut: string;
}): Promise<DaemonResponse | NonNullable<SessionState['recording']>> {
  const { req, activeSession, device, logPath, deps, recordingBase, resolvedOut } = params;

  if (recordingBase.showTouches) {
    await warmIosSimulatorRunner({
      req,
      activeSession,
      device,
      logPath,
      deps,
    });
  }
  const { child, wait } = deps.startIosSimulatorRecording({ device, outPath: resolvedOut });
  const readyAt = await waitForLocalRecordingSettleWindow(resolvedOut);
  let gestureClockOriginAtMs: number | undefined;
  let gestureClockOriginUptimeMs: number | undefined;
  if (recordingBase.showTouches) {
    try {
      const uptimeRequestStartedAtMs = Date.now();
      const uptimeResult = await deps.runIosRunnerCommand(
        device,
        {
          command: 'uptime',
          appBundleId: normalizeAppBundleId(activeSession),
        },
        getIosRunnerOptions(req, logPath, activeSession),
      );
      const uptimeRequestFinishedAtMs = Date.now();
      gestureClockOriginAtMs = Math.round(
        (uptimeRequestStartedAtMs + uptimeRequestFinishedAtMs) / 2,
      );
      gestureClockOriginUptimeMs =
        typeof uptimeResult.currentUptimeMs === 'number' ? uptimeResult.currentUptimeMs : undefined;
    } catch {
      // Best effort only; wall-clock fallback remains available.
    }
  }
  return {
    platform: 'ios',
    child,
    wait,
    ...recordingBase,
    startedAt: readyAt,
    gestureClockOriginAtMs:
      gestureClockOriginUptimeMs === undefined ? undefined : gestureClockOriginAtMs,
    gestureClockOriginUptimeMs,
  };
}

// --- Start recording orchestrator ---

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
    return errorResponse('INVALID_ARGS', 'recording already in progress');
  }

  const fpsFlag = req.flags?.fps;
  const qualityFlag = req.flags?.quality;
  if (
    fpsFlag !== undefined &&
    (!Number.isInteger(fpsFlag) ||
      fpsFlag < IOS_DEVICE_RECORD_MIN_FPS ||
      fpsFlag > IOS_DEVICE_RECORD_MAX_FPS)
  ) {
    return errorResponse(
      'INVALID_ARGS',
      `fps must be an integer between ${IOS_DEVICE_RECORD_MIN_FPS} and ${IOS_DEVICE_RECORD_MAX_FPS}`,
    );
  }
  if (
    qualityFlag !== undefined &&
    (!Number.isInteger(qualityFlag) ||
      qualityFlag < RECORDING_MIN_QUALITY ||
      qualityFlag > RECORDING_MAX_QUALITY)
  ) {
    return errorResponse(
      'INVALID_ARGS',
      `quality must be an integer between ${RECORDING_MIN_QUALITY} and ${RECORDING_MAX_QUALITY}`,
    );
  }

  if (!isCommandSupportedOnDevice('record', device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'record is not supported on this device');
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
      return errorResponse(
        'INVALID_ARGS',
        'record on physical iOS devices requires an active app session; run open <app> first',
      );
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
  } else if (device.platform === 'macos') {
    const appBundleId = normalizeAppBundleId(activeSession);
    if (!appBundleId) {
      return errorResponse(
        'INVALID_ARGS',
        'record on macOS requires an active app session; run open <app> first',
      );
    }
    recording = await startMacOsRecording({
      req,
      activeSession,
      device,
      logPath,
      deps,
      fpsFlag,
      recordingBase,
      appBundleId,
    });
  } else if (device.platform === 'ios') {
    recording = await startIosSimulatorRecording({
      req,
      activeSession,
      device,
      logPath,
      deps,
      recordingBase,
      resolvedOut,
    });
  } else {
    recording = await startAndroidRecording({ device, recordingBase });
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

// --- Stop recording helpers ---

async function stopNonRunnerRecording(params: {
  deps: RecordTraceDeps;
  device: SessionState['device'];
  recording: Extract<NonNullable<SessionState['recording']>, { platform: 'ios' | 'android' }>;
}): Promise<DaemonResponse | null> {
  const { deps, device, recording } = params;
  if (recording.platform === 'android') {
    return await stopAndroidRecording({ deps, device, recording });
  }

  await withDiagnosticTimer('record_stop_tail_settle', () => deps.waitForRecordingTail(recording), {
    platform: recording.platform,
    gestureEventCount: recording.gestureEvents.length,
  });
  const stopResult = await withDiagnosticTimer(
    'record_stop_ios_simulator_process',
    () => stopIosSimulatorRecordingProcess({ deps, recording }),
    {
      outPath: recording.outPath,
    },
  );
  if (!stopResult) {
    return errorResponse(
      'COMMAND_FAILED',
      `failed to stop recording: simctl recordVideo did not exit after ${IOS_SIMULATOR_RECORDING_STOP_TIMEOUT_MS}ms and forced cleanup`,
    );
  }
  if (stopResult.exitCode !== 0) {
    return errorResponse(
      'COMMAND_FAILED',
      `failed to stop recording: ${formatRecordTraceExecFailure(stopResult, 'simctl recordVideo')}`,
    );
  }

  await withDiagnosticTimer(
    'record_stop_video_stable',
    () =>
      deps.waitForStableFile(recording.outPath, {
        pollMs: IOS_SIMULATOR_VIDEO_READY_POLL_MS,
        attempts: IOS_SIMULATOR_VIDEO_READY_ATTEMPTS,
      }),
    {
      outPath: recording.outPath,
    },
  );
  const playable = await withDiagnosticTimer(
    'record_stop_video_playable_check',
    () => deps.isPlayableVideo(recording.outPath),
    {
      outPath: recording.outPath,
    },
  );
  if (!playable) {
    return errorResponse(
      'COMMAND_FAILED',
      `failed to stop recording: ${recording.outPath} was not finalized into a playable video`,
    );
  }

  if (recording.quality !== undefined && recording.quality < RECORDING_MAX_QUALITY) {
    const quality = recording.quality;
    try {
      await withDiagnosticTimer(
        'record_stop_resize',
        () =>
          deps.resizeRecording({
            videoPath: recording.outPath,
            quality,
            targetLabel: 'iOS recording',
          }),
        {
          outPath: recording.outPath,
          quality,
        },
      );
    } catch (error) {
      recording.overlayWarning = `failed to resize recording: ${formatRecordTraceError(error)}`;
    }
  }

  await withDiagnosticTimer(
    'record_stop_finalize_overlay',
    () =>
      finalizeRecordingOverlay({
        recording,
        deps,
        targetLabel: 'iOS recording',
      }),
    {
      outPath: recording.outPath,
      showTouches: recording.showTouches,
      gestureEventCount: recording.gestureEvents.length,
    },
  );

  return null;
}

async function stopIosSimulatorRecordingProcess(params: {
  deps: RecordTraceDeps;
  recording: Extract<NonNullable<SessionState['recording']>, { platform: 'ios' }>;
}): Promise<ExecResult | null> {
  const { deps, recording } = params;
  recording.child.kill('SIGINT');
  let result = await waitForRecordingProcessExit(
    recording.wait,
    IOS_SIMULATOR_RECORDING_STOP_TIMEOUT_MS,
  );
  if (result) return result;

  await signalMatchingIosSimulatorRecorders(deps, recording.outPath, 'SIGINT');
  result = await waitForRecordingProcessExit(
    recording.wait,
    IOS_SIMULATOR_RECORDING_FORCE_STOP_TIMEOUT_MS,
  );
  if (result) return result;

  recording.child.kill('SIGTERM');
  await signalMatchingIosSimulatorRecorders(deps, recording.outPath, 'SIGTERM');
  result = await waitForRecordingProcessExit(
    recording.wait,
    IOS_SIMULATOR_RECORDING_FORCE_STOP_TIMEOUT_MS,
  );
  if (result) return result;

  recording.child.kill('SIGKILL');
  await signalMatchingIosSimulatorRecorders(deps, recording.outPath, 'SIGKILL');
  return await waitForRecordingProcessExit(
    recording.wait,
    IOS_SIMULATOR_RECORDING_FORCE_STOP_TIMEOUT_MS,
  );
}

async function waitForRecordingProcessExit(
  wait: Promise<ExecResult>,
  timeoutMs: number,
): Promise<ExecResult | null> {
  return await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
}

async function signalMatchingIosSimulatorRecorders(
  deps: RecordTraceDeps,
  outPath: string,
  signal: NodeJS.Signals,
): Promise<void> {
  const pattern = `simctl.*recordVideo.*${escapeProcessRegex(outPath)}`;
  let result: ExecResult;
  try {
    result = await deps.runCmd('pgrep', ['-f', pattern], { allowFailure: true });
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'record_stop_ios_simulator_pgrep_failed',
      data: {
        outPath,
        signal,
        error: formatRecordTraceError(error),
      },
    });
    return;
  }

  const pids = result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  let signaled = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      signaled += 1;
    } catch {
      // Process already exited or cannot be signaled; continue best-effort cleanup.
    }
  }

  emitDiagnostic({
    level: signaled > 0 ? 'warn' : 'debug',
    phase: 'record_stop_ios_simulator_signal_recorders',
    data: {
      outPath,
      signal,
      matchedPidCount: pids.length,
      signaled,
      pgrepExitCode: result.exitCode,
    },
  });
}

function escapeProcessRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    return errorResponse('INVALID_ARGS', 'no active recording');
  }

  const recording = activeSession.recording;
  const invalidatedReason = recording.invalidatedReason;
  activeSession.recording = undefined;

  const stopError =
    recording.platform === 'ios-device-runner'
      ? await stopIosDeviceRecording({ req, activeSession, device, logPath, deps, recording })
      : recording.platform === 'macos-runner'
        ? await stopMacOsRecording({ req, activeSession, device, logPath, deps, recording })
        : await stopNonRunnerRecording({ deps, device, recording });
  if (stopError) {
    return stopError;
  }

  if (invalidatedReason) {
    return errorResponse('COMMAND_FAILED', invalidatedReason);
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
      overlayWarning: recording.overlayWarning,
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

// --- Main command handler ---

export async function handleRecordCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  logPath?: string;
}): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, logPath } = params;
  const deps = buildRecordTraceDeps();
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
    return errorResponse('INVALID_ARGS', 'record requires start|stop');
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
