import { setTimeout as sleep } from 'node:timers/promises';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { asAppError } from '../../utils/errors.ts';
import {
  clearRequestCanceled,
  markRequestCanceled,
  registerRequestAbort,
} from '../request-cancel.ts';
import type { DaemonResponse } from '../types.ts';
import type { ReplayScriptMetadata } from './session-replay-script.ts';

const REPLAY_TIMEOUT_CLEANUP_GRACE_MS = 2_000;
const REPLAY_TEST_TIMEOUT_HINT =
  'Replay test timeouts are cooperative; the active command may take a short grace period to stop.';

export async function runReplayTestAttempt(params: {
  filePath: string;
  sessionName: string;
  requestId: string;
  timeoutMs?: number;
  platform?: ReplayScriptMetadata['platform'];
  runReplay: (params: {
    filePath: string;
    sessionName: string;
    platform?: ReplayScriptMetadata['platform'];
    requestId?: string;
    artifactPaths?: Set<string>;
  }) => Promise<DaemonResponse>;
  cleanupSession: (sessionName: string) => Promise<void>;
}): Promise<DaemonResponse> {
  const { filePath, sessionName, requestId, timeoutMs, platform, runReplay, cleanupSession } =
    params;
  registerRequestAbort(requestId);
  const artifactPaths = new Set<string>();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const replayPromise = runReplay({
    filePath,
    sessionName,
    platform,
    requestId,
    artifactPaths,
  }).catch((error) => {
    const appErr = asAppError(error);
    return { ok: false, error: { code: appErr.code, message: appErr.message } } as DaemonResponse;
  });

  try {
    const response =
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
    return response;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (timedOut) {
      const settled = await waitForReplayAfterTimeout(replayPromise);
      if (!settled) {
        emitDiagnostic({
          level: 'warn',
          phase: 'test_timeout_cleanup_race',
          data: {
            session: sessionName,
            requestId,
            graceMs: REPLAY_TIMEOUT_CLEANUP_GRACE_MS,
          },
        });
      }
    }
    clearRequestCanceled(requestId);
    try {
      await cleanupSession(sessionName);
    } catch (error) {
      const appErr = asAppError(error);
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
