import path from 'node:path';
import { asAppError } from '../../utils/errors.ts';
import { errorResponse } from './response.ts';
import type {
  DaemonRequest,
  DaemonResponse,
  ReplaySuiteResult,
  ReplaySuiteTestFailed,
  ReplaySuiteTestResult,
} from '../types.ts';
import {
  buildReplayTestArtifactSlug,
  materializeReplayTestAttemptArtifacts,
  prepareReplayTestAttemptArtifacts,
  resolveReplayTestArtifactsDir,
} from './session-test-artifacts.ts';
import { emitRequestProgress } from '../request-progress.ts';
import {
  buildReplayTestAttemptRequestId,
  buildReplayTestInvocationId,
  buildReplayTestSessionName,
  discoverReplayTestEntries,
  resolveReplayTestRetries,
  resolveReplayTestTimeout,
} from './session-test-discovery.ts';
import { isReplayInfrastructureFailure } from './session-test-infrastructure.ts';
import { runReplayTestAttempt } from './session-test-runtime.ts';
import type { ReplayTestRuntimeDependencies } from './session-test-types.ts';

// fallow-ignore-next-line complexity
export async function runReplayTestSuite(
  params: {
    req: DaemonRequest;
    sessionName: string;
  } & ReplayTestRuntimeDependencies,
): Promise<DaemonResponse> {
  const { req, sessionName, runReplay, cleanupSession } = params;
  if ((req.positionals?.length ?? 0) === 0) {
    return errorResponse('INVALID_ARGS', 'test requires at least one path or glob');
  }

  try {
    const entries = discoverReplayTestEntries({
      inputs: req.positionals,
      cwd: req.meta?.cwd,
      platformFilter: req.flags?.platform,
      replayBackend: req.flags?.replayBackend,
    });
    const suiteInvocationId = buildReplayTestInvocationId(req.meta?.requestId);
    const suiteArtifactsDir = resolveReplayTestArtifactsDir({
      artifactsDir:
        typeof req.flags?.artifactsDir === 'string' ? req.flags.artifactsDir : undefined,
      cwd: req.meta?.cwd,
      suiteInvocationId,
    });

    const results: ReplaySuiteTestResult[] = [];
    const suiteStartedAt = Date.now();
    let executed = 0;

    for (const [entryIndex, entry] of entries.entries()) {
      if (entry.kind === 'skip') {
        emitRequestProgress({
          type: 'replay-test',
          file: entry.path,
          status: 'skip',
          index: entryIndex + 1,
          total: entries.length,
          message: entry.message,
        });
        results.push({
          file: entry.path,
          status: 'skipped',
          durationMs: 0,
          reason: entry.reason,
          message: entry.message,
        });
        continue;
      }

      executed += 1;
      const result = await runReplayTestCase({
        entry,
        sessionName,
        suiteInvocationId,
        caseIndex: executed - 1,
        cwd: req.meta?.cwd,
        requestId: req.meta?.requestId,
        retries: resolveReplayTestRetries(req.flags?.retries, entry.metadata.retries),
        timeoutMs: resolveReplayTestTimeout(req.flags?.timeoutMs, entry.metadata.timeoutMs),
        suiteArtifactsDir,
        suiteIndex: entryIndex + 1,
        suiteTotal: entries.length,
        runReplay,
        cleanupSession,
      });
      results.push(result);
      if (req.flags?.failFast === true || isReplayInfrastructureFailure(result)) break;
    }

    const data = summarizeReplayTestResults(entries.length, results, Date.now() - suiteStartedAt);
    return { ok: true, data };
  } catch (err) {
    const appErr = asAppError(err);
    return errorResponse(appErr.code, appErr.message);
  }
}

// fallow-ignore-next-line complexity
async function runReplayTestCase(
  params: {
    entry: Extract<
      ReturnType<typeof discoverReplayTestEntries>[number],
      {
        kind: 'run';
      }
    >;
    sessionName: string;
    suiteInvocationId: string;
    caseIndex: number;
    cwd?: string;
    requestId?: string;
    retries: number;
    timeoutMs?: number;
    suiteArtifactsDir: string;
    suiteIndex: number;
    suiteTotal: number;
  } & ReplayTestRuntimeDependencies,
): Promise<Extract<ReplaySuiteTestResult, { status: 'passed' | 'failed' }>> {
  const {
    entry,
    sessionName,
    suiteInvocationId,
    caseIndex,
    cwd,
    requestId,
    retries,
    timeoutMs,
    suiteArtifactsDir,
    suiteIndex,
    suiteTotal,
    runReplay,
    cleanupSession,
  } = params;
  const testStartedAt = Date.now();
  const testArtifactsDir = path.join(
    suiteArtifactsDir,
    buildReplayTestArtifactSlug(entry.path, cwd),
  );
  let finalResponse: DaemonResponse | undefined;
  let finalSessionName = '';
  let attempts = 0;

  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    attempts = attemptIndex + 1;
    const testSessionName = buildReplayTestSessionName(
      sessionName,
      suiteInvocationId,
      entry.path,
      caseIndex,
      attemptIndex,
    );
    const attemptArtifactsDir = path.join(testArtifactsDir, `attempt-${attempts}`);
    prepareReplayTestAttemptArtifacts(entry.path, attemptArtifactsDir);

    const attemptRequestId = buildReplayTestAttemptRequestId({
      requestId,
      suiteInvocationId,
      filePath: entry.path,
      caseIndex,
      attemptIndex,
    });
    const response = await runReplayTestAttempt({
      filePath: entry.path,
      sessionName: testSessionName,
      requestId: attemptRequestId,
      timeoutMs,
      platform: entry.metadata.platform,
      target: entry.metadata.target,
      artifactsDir: attemptArtifactsDir,
      runReplay,
      cleanupSession,
    });
    materializeReplayTestAttemptArtifacts({
      response,
      filePath: entry.path,
      sessionName: testSessionName,
      attempts,
      maxAttempts: retries + 1,
      attemptArtifactsDir,
    });
    finalResponse = response;
    finalSessionName = testSessionName;
    if (response.ok) break;
    if (isReplayInfrastructureFailure(response)) break;
    if (attemptIndex >= retries) break;
    emitRequestProgress({
      type: 'replay-test',
      file: entry.path,
      status: 'fail',
      index: suiteIndex,
      total: suiteTotal,
      attempt: attempts,
      maxAttempts: retries + 1,
      retrying: true,
      message: response.error.message,
    });
  }

  const durationMs = Date.now() - testStartedAt;
  if (finalResponse?.ok) {
    emitRequestProgress({
      type: 'replay-test',
      file: entry.path,
      status: 'pass',
      index: suiteIndex,
      total: suiteTotal,
      attempt: attempts,
      maxAttempts: retries + 1,
      durationMs,
      artifactsDir: testArtifactsDir,
    });
    return {
      file: entry.path,
      session: finalSessionName,
      status: 'passed',
      durationMs,
      attempts,
      artifactsDir: testArtifactsDir,
      replayed: typeof finalResponse.data?.replayed === 'number' ? finalResponse.data.replayed : 0,
      healed: typeof finalResponse.data?.healed === 'number' ? finalResponse.data.healed : 0,
    };
  }

  const error = finalResponse?.ok
    ? { code: 'COMMAND_FAILED', message: 'Unknown replay test failure' }
    : (finalResponse?.error ?? {
        code: 'COMMAND_FAILED',
        message: 'Unknown replay test failure',
      });
  emitRequestProgress({
    type: 'replay-test',
    file: entry.path,
    status: 'fail',
    index: suiteIndex,
    total: suiteTotal,
    attempt: attempts,
    maxAttempts: retries + 1,
    durationMs,
    artifactsDir: testArtifactsDir,
    message: error.message,
  });
  return {
    file: entry.path,
    session: finalSessionName,
    status: 'failed',
    durationMs,
    attempts,
    artifactsDir: testArtifactsDir,
    error,
  };
}

function summarizeReplayTestResults(
  total: number,
  results: ReplaySuiteTestResult[],
  durationMs: number,
): ReplaySuiteResult {
  const passed = results.filter((result) => result.status === 'passed').length;
  const failedResults = results.filter(
    (result): result is ReplaySuiteTestFailed => result.status === 'failed',
  );
  const failed = failedResults.length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const executed = passed + failed;
  return {
    total,
    executed,
    passed,
    failed,
    skipped,
    notRun: Math.max(0, total - executed - skipped),
    durationMs,
    failures: failedResults,
    tests: results,
  };
}
