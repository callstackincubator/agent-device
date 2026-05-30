import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { normalizeError } from '../../utils/errors.ts';
import {
  clearRequestCanceled,
  markRequestCanceled,
  registerRequestAbort,
} from '../request-cancel.ts';
import type { DaemonResponse } from '../types.ts';
import type { ReplayScriptMetadata } from '../../replay/script.ts';
import type { ReplayTestRuntimeDependencies } from './session-test-types.ts';

const REPLAY_TIMEOUT_CLEANUP_GRACE_MS = 2_000;
const REPLAY_TEST_TIMEOUT_HINT =
  'Replay test timeouts are cooperative; the active command may take a short grace period to stop.';
const REPLAY_TIMEOUT_CLEANUP_PENDING_REASON = 'timeout_cleanup_pending';

export async function runReplayTestAttempt(
  params: {
    filePath: string;
    sessionName: string;
    requestId: string;
    timeoutMs?: number;
    platform?: ReplayScriptMetadata['platform'];
    target?: ReplayScriptMetadata['target'];
    artifactsDir?: string;
  } & ReplayTestRuntimeDependencies,
): Promise<DaemonResponse> {
  const {
    filePath,
    sessionName,
    requestId,
    timeoutMs,
    platform,
    target,
    artifactsDir,
    runReplay,
    cleanupSession,
  } = params;
  registerRequestAbort(requestId);
  const artifactPaths = new Set<string>();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let response: DaemonResponse | undefined;
  const attemptStartedAt = Date.now();
  const tracePath = prepareReplayTestTimingTrace({
    artifactsDir,
    artifactPaths,
    filePath,
    sessionName,
    requestId,
    timeoutMs,
    platform,
    target,
  });
  const replayPromise = runReplay({
    filePath,
    sessionName,
    platform,
    target,
    requestId,
    artifactsDir,
    artifactPaths,
    tracePath,
  })
    .catch((error) => {
      const appErr = normalizeError(error);
      return {
        ok: false,
        error: appErr,
      } satisfies DaemonResponse;
    })
    .finally(() => {
      clearRequestCanceled(requestId);
    });

  try {
    response =
      typeof timeoutMs === 'number'
        ? await Promise.race([
            replayPromise,
            new Promise<DaemonResponse>((resolve) => {
              timeoutHandle = setTimeout(() => {
                timedOut = true;
                markRequestCanceled(requestId);
                resolve(createReplayTestTimeoutResponse(timeoutMs, [...artifactPaths]));
              }, timeoutMs);
            }),
          ])
        : await replayPromise;
    appendReplayTestTimingEvent(tracePath, {
      type: 'replay_test_attempt_stop',
      ts: new Date().toISOString(),
      session: sessionName,
      ok: response.ok,
      timedOut,
      durationMs: Date.now() - attemptStartedAt,
      errorCode: response.ok ? undefined : response.error.code,
    });
    return response;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (timedOut) {
      const settled = await waitForReplayAfterTimeout(replayPromise);
      if (!settled) {
        markReplayTimeoutCleanupPending(response);
        emitDiagnostic({
          level: 'warn',
          phase: 'test_timeout_cleanup_race',
          data: {
            session: sessionName,
            requestId,
            graceMs: REPLAY_TIMEOUT_CLEANUP_GRACE_MS,
          },
        });
        void cleanupSessionAfterLateReplay({
          replayPromise,
          cleanupSession,
          sessionName,
          requestId,
        });
      }
    }
    const cleanupStartedAt = Date.now();
    try {
      appendReplayTestTimingEvent(tracePath, {
        type: 'replay_test_cleanup_start',
        ts: new Date().toISOString(),
        session: sessionName,
      });
      await cleanupSession(sessionName);
      appendReplayTestTimingEvent(tracePath, {
        type: 'replay_test_cleanup_stop',
        ts: new Date().toISOString(),
        session: sessionName,
        ok: true,
        durationMs: Date.now() - cleanupStartedAt,
      });
    } catch (error) {
      const appErr = normalizeError(error);
      appendReplayTestTimingEvent(tracePath, {
        type: 'replay_test_cleanup_stop',
        ts: new Date().toISOString(),
        session: sessionName,
        ok: false,
        durationMs: Date.now() - cleanupStartedAt,
        errorCode: appErr.code,
      });
      emitDiagnostic({
        level: 'warn',
        phase: 'test_cleanup_failed',
        data: {
          session: sessionName,
          error: appErr.message,
        },
      });
    }
  }
}

async function waitForReplayAfterTimeout(replayPromise: Promise<DaemonResponse>): Promise<boolean> {
  return await Promise.race([
    replayPromise.then(() => true),
    sleep(REPLAY_TIMEOUT_CLEANUP_GRACE_MS).then(() => false),
  ]);
}

async function cleanupSessionAfterLateReplay(params: {
  replayPromise: Promise<DaemonResponse>;
  cleanupSession: ReplayTestRuntimeDependencies['cleanupSession'];
  sessionName: string;
  requestId: string;
}): Promise<void> {
  const { replayPromise, cleanupSession, sessionName, requestId } = params;
  try {
    await replayPromise;
  } finally {
    try {
      await cleanupSession(sessionName);
    } catch (error) {
      const appErr = normalizeError(error);
      emitDiagnostic({
        level: 'warn',
        phase: 'test_late_cleanup_failed',
        data: {
          session: sessionName,
          requestId,
          error: appErr.message,
        },
      });
    }
  }
}

function markReplayTimeoutCleanupPending(response: DaemonResponse | undefined): void {
  if (!response || response.ok) return;
  response.error.details = {
    ...(response.error.details ?? {}),
    reason: REPLAY_TIMEOUT_CLEANUP_PENDING_REASON,
    timeoutCleanupPending: true,
  };
}

function prepareReplayTestTimingTrace(params: {
  artifactsDir?: string;
  artifactPaths: Set<string>;
  filePath: string;
  sessionName: string;
  requestId: string;
  timeoutMs?: number;
  platform?: ReplayScriptMetadata['platform'];
  target?: ReplayScriptMetadata['target'];
}): string | undefined {
  const {
    artifactsDir,
    artifactPaths,
    filePath,
    sessionName,
    requestId,
    timeoutMs,
    platform,
    target,
  } = params;
  if (!artifactsDir) return undefined;
  const tracePath = path.join(artifactsDir, 'replay-timing.ndjson');
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.writeFileSync(tracePath, '');
  artifactPaths.add(tracePath);
  appendReplayTestTimingEvent(tracePath, {
    type: 'replay_test_attempt_start',
    ts: new Date().toISOString(),
    replayPath: filePath,
    session: sessionName,
    requestId,
    timeoutMs,
    platform,
    target,
  });
  return tracePath;
}

function appendReplayTestTimingEvent(
  tracePath: string | undefined,
  event: Record<string, unknown>,
): void {
  if (!tracePath) return;
  fs.appendFileSync(tracePath, `${JSON.stringify(event)}\n`);
}

function createReplayTestTimeoutResponse(
  timeoutMs: number,
  artifactPaths: string[] = [],
): DaemonResponse {
  return {
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message: `TIMEOUT after ${timeoutMs}ms`,
      hint: REPLAY_TEST_TIMEOUT_HINT,
      details: {
        reason: 'timeout',
        timeoutMs,
        timeoutMode: 'cooperative',
        artifactPaths,
      },
    },
  };
}
