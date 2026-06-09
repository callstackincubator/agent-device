import path from 'node:path';
import type { DaemonOpenLifecycle, DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { sleep } from '../../utils/timeouts.ts';
import { handleRecordCommand } from './record-trace-recording.ts';
import { appendReplayTestTimingEvent } from './session-test-runtime.ts';
import { collectReplayActionArtifactPaths } from './session-replay-runtime.ts';

const REPLAY_TEST_VIDEO_RECORDING_PREROLL_MS = 1_000;
const REPLAY_TEST_VIDEO_RECORDING_TAIL_MS = 3_000;

export type ReplayTestVideoRecording = {
  openLifecycle: DaemonOpenLifecycle | undefined;
  startIfReady: () => Promise<DaemonResponse | undefined>;
  finalize: (artifactPaths: Set<string>) => Promise<DaemonResponse | undefined>;
};

export function createReplayTestVideoRecording(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  artifactsDir: string | undefined;
  tracePath: string | undefined;
}): ReplayTestVideoRecording {
  const { req, sessionName, logPath, sessionStore, artifactsDir, tracePath } = params;
  const enabled = req.flags?.recordVideo === true;
  const openLifecycle = enabled
    ? {
        beforeDispatch: async () => await startIfReady(),
      }
    : undefined;

  async function startIfReady(): Promise<DaemonResponse | undefined> {
    if (!enabled) return undefined;
    const activeSession = sessionStore.get(sessionName);
    if (!activeSession || activeSession.recording) return undefined;

    const videoPath = artifactsDir
      ? path.join(artifactsDir, 'recording.mp4')
      : `./recording-${Date.now()}.mp4`;
    appendVideoTimingEvent(tracePath, {
      type: 'video_recording_start',
      session: sessionName,
      videoPath,
    });
    emitDiagnostic({
      phase: 'replay_test_video_recording_start',
      data: { session: sessionName, videoPath },
    });
    const startResponse = await handleRecordCommand({
      req: {
        token: req.token,
        session: sessionName,
        command: 'record',
        positionals: ['start', videoPath],
        flags: {},
        meta: req.meta,
      },
      sessionName,
      sessionStore,
      logPath,
    });
    if (!startResponse.ok) {
      appendVideoTimingEvent(tracePath, {
        type: 'video_recording_start_failed',
        session: sessionName,
        videoPath,
        errorCode: startResponse.error.code,
      });
      return startResponse;
    }

    const prerollStartedAt = Date.now();
    await sleep(REPLAY_TEST_VIDEO_RECORDING_PREROLL_MS);
    appendVideoTimingEvent(tracePath, {
      type: 'video_preroll_done',
      session: sessionName,
      durationMs: Date.now() - prerollStartedAt,
      requestedDurationMs: REPLAY_TEST_VIDEO_RECORDING_PREROLL_MS,
    });
    emitDiagnostic({
      phase: 'replay_test_video_recording_preroll_done',
      durationMs: Date.now() - prerollStartedAt,
      data: { session: sessionName, requestedDurationMs: REPLAY_TEST_VIDEO_RECORDING_PREROLL_MS },
    });
    return startResponse;
  }

  async function finalize(artifactPaths: Set<string>): Promise<DaemonResponse | undefined> {
    if (!enabled) return undefined;
    if (!sessionStore.get(sessionName)?.recording) return undefined;

    appendVideoTimingEvent(tracePath, {
      type: 'video_tail_start',
      session: sessionName,
      requestedDurationMs: REPLAY_TEST_VIDEO_RECORDING_TAIL_MS,
    });
    const tailStartedAt = Date.now();
    await sleep(REPLAY_TEST_VIDEO_RECORDING_TAIL_MS);
    const stopStartedAt = Date.now();
    const stopResponse = await handleRecordCommand({
      req: {
        token: req.token,
        session: sessionName,
        command: 'record',
        positionals: ['stop'],
        flags: {},
        meta: req.meta,
      },
      sessionName,
      sessionStore,
      logPath,
    });
    collectReplayActionArtifactPaths(stopResponse).forEach((entry) => artifactPaths.add(entry));
    appendVideoTimingEvent(tracePath, {
      type: 'video_recording_stop',
      session: sessionName,
      ok: stopResponse.ok,
      durationMs: Date.now() - stopStartedAt,
      tailDurationMs: stopStartedAt - tailStartedAt,
      errorCode: stopResponse.ok ? undefined : stopResponse.error.code,
    });
    emitDiagnostic({
      phase: 'replay_test_video_recording_stop',
      durationMs: Date.now() - stopStartedAt,
      data: {
        session: sessionName,
        ok: stopResponse.ok,
        tailDurationMs: stopStartedAt - tailStartedAt,
      },
    });
    return stopResponse;
  }

  return {
    openLifecycle,
    startIfReady,
    finalize,
  };
}

function appendVideoTimingEvent(
  tracePath: string | undefined,
  event: Record<string, unknown>,
): void {
  appendReplayTestTimingEvent(tracePath, {
    ...event,
    ts: new Date().toISOString(),
  });
}
