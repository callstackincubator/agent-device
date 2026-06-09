import path from 'node:path';
import { asAppError, normalizeError } from '../../utils/errors.ts';
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
import { buildReplayTestShardPlan, type ReplayTestShardContext } from './session-test-sharding.ts';

type ReplayTestEntry = ReturnType<typeof discoverReplayTestEntries>[number];
type ReplayTestRunEntry = Extract<ReplayTestEntry, { kind: 'run' }>;

// fallow-ignore-next-line complexity
export async function runReplayTestSuite(
  params: {
    req: DaemonRequest;
    sessionName: string;
  } & ReplayTestRuntimeDependencies,
): Promise<DaemonResponse> {
  const { req, sessionName, runReplay, cleanupSession, finalizeAttempt } = params;
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

    const suiteStartedAt = Date.now();
    const skipped = entries.filter((entry) => entry.kind === 'skip');
    const runnable = entries.filter((entry): entry is ReplayTestRunEntry => entry.kind === 'run');
    const shardPlan = await buildReplayTestShardPlan(req.flags, runnable, skipped.length);
    const results: ReplaySuiteTestResult[] = shardPlan
      ? emitSkippedReplayTestResults({
          entries,
          total: shardPlan.total,
        })
      : [];

    if (shardPlan) {
      results.push(
        ...(await runReplayTestShards({
          shards: shardPlan.shards,
          sessionName,
          suiteInvocationId,
          cwd: req.meta?.cwd,
          requestId: req.meta?.requestId,
          flags: req.flags,
          suiteArtifactsDir,
          suiteTotal: shardPlan.total,
          runReplay,
          cleanupSession,
          finalizeAttempt,
        })),
      );
    } else {
      results.push(
        ...(await runReplayTestEntriesInDiscoveryOrder({
          discoveryEntries: entries,
          sessionName,
          suiteInvocationId,
          cwd: req.meta?.cwd,
          requestId: req.meta?.requestId,
          flags: req.flags,
          suiteArtifactsDir,
          suiteTotal: entries.length,
          runReplay,
          cleanupSession,
          finalizeAttempt,
        })),
      );
    }

    const data = summarizeReplayTestResults(
      shardPlan?.total ?? entries.length,
      results,
      Date.now() - suiteStartedAt,
    );
    return { ok: true, data };
  } catch (err) {
    const appErr = asAppError(err);
    return errorResponse(appErr.code, appErr.message);
  }
}

function emitSkippedReplayTestResults(params: {
  entries: ReplayTestEntry[];
  total: number;
}): ReplaySuiteTestResult[] {
  const { entries, total } = params;
  const results: ReplaySuiteTestResult[] = [];
  for (const [entryIndex, entry] of entries.entries()) {
    if (entry.kind !== 'skip') continue;
    emitRequestProgress({
      type: 'replay-test',
      file: entry.path,
      status: 'skip',
      index: entryIndex + 1,
      total,
      message: entry.message,
    });
    results.push({
      file: entry.path,
      status: 'skipped',
      durationMs: 0,
      reason: entry.reason,
      message: entry.message,
    });
  }
  return results;
}

async function runReplayTestShards(
  params: {
    shards: Array<ReplayTestShardContext & { entries: ReplayTestRunEntry[] }>;
    sessionName: string;
    suiteInvocationId: string;
    cwd?: string;
    requestId?: string;
    flags: DaemonRequest['flags'];
    suiteArtifactsDir: string;
    suiteTotal: number;
  } & ReplayTestRuntimeDependencies,
): Promise<ReplaySuiteTestResult[]> {
  const settled = await Promise.allSettled(
    params.shards.map(async (shard) => await runReplayTestShard({ ...params, shard })),
  );
  return settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const shard = params.shards[index];
    return shard ? [buildUnexpectedShardFailure(shard, params.sessionName, result.reason)] : [];
  });
}

function buildUnexpectedShardFailure(
  shard: ReplayTestShardContext & { entries: ReplayTestRunEntry[] },
  sessionName: string,
  reason: unknown,
): ReplaySuiteTestFailed {
  const appErr = normalizeError(reason);
  return {
    file: shard.entries[0]?.path ?? `shard-${shard.shardIndex + 1}`,
    session: formatReplayTestShardSessionName(sessionName, shard),
    status: 'failed',
    durationMs: 0,
    attempts: 1,
    error: {
      code: appErr.code,
      message: appErr.message,
      hint: appErr.hint,
      diagnosticId: appErr.diagnosticId,
      logPath: appErr.logPath,
      details: appErr.details,
    },
    shardIndex: shard.shardIndex,
    shardCount: shard.shardCount,
    deviceId: shard.device.id,
  };
}

async function runReplayTestShard(
  params: {
    shard: ReplayTestShardContext & { entries: ReplayTestRunEntry[] };
    sessionName: string;
    suiteInvocationId: string;
    cwd?: string;
    requestId?: string;
    flags: DaemonRequest['flags'];
    suiteArtifactsDir: string;
    suiteTotal: number;
  } & ReplayTestRuntimeDependencies,
): Promise<ReplaySuiteTestResult[]> {
  const { shard, sessionName } = params;
  return await runReplayTestEntries({
    ...params,
    entries: shard.entries,
    sessionName: formatReplayTestShardSessionName(sessionName, shard),
    shard,
  });
}

function formatReplayTestShardSessionName(
  sessionName: string,
  shard: ReplayTestShardContext,
): string {
  return `${sessionName}:shard-${shard.shardIndex + 1}`;
}

async function runReplayTestEntriesInDiscoveryOrder(
  params: {
    discoveryEntries: ReplayTestEntry[];
    sessionName: string;
    suiteInvocationId: string;
    cwd?: string;
    requestId?: string;
    flags: DaemonRequest['flags'];
    suiteArtifactsDir: string;
    suiteTotal: number;
  } & ReplayTestRuntimeDependencies,
): Promise<ReplaySuiteTestResult[]> {
  const {
    discoveryEntries,
    sessionName,
    suiteInvocationId,
    cwd,
    requestId,
    flags,
    suiteArtifactsDir,
    suiteTotal,
    runReplay,
    cleanupSession,
    finalizeAttempt,
  } = params;
  const results: ReplaySuiteTestResult[] = [];
  let executed = 0;
  for (const [entryIndex, entry] of discoveryEntries.entries()) {
    if (entry.kind === 'skip') {
      emitRequestProgress({
        type: 'replay-test',
        file: entry.path,
        status: 'skip',
        index: entryIndex + 1,
        total: suiteTotal,
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
      cwd,
      requestId,
      retries: resolveReplayTestRetries(flags?.retries, entry.metadata.retries),
      timeoutMs: resolveReplayTestTimeout(flags?.timeoutMs, entry.metadata.timeoutMs),
      suiteArtifactsDir,
      suiteIndex: entryIndex + 1,
      suiteTotal,
      runReplay,
      cleanupSession,
      finalizeAttempt,
    });
    results.push(result);
    if (flags?.failFast === true || isReplayInfrastructureFailure(result)) break;
  }
  return results;
}

async function runReplayTestEntries(
  params: {
    entries: ReplayTestRunEntry[];
    sessionName: string;
    suiteInvocationId: string;
    cwd?: string;
    requestId?: string;
    flags: DaemonRequest['flags'];
    suiteArtifactsDir: string;
    suiteTotal: number;
    shard?: ReplayTestShardContext;
  } & ReplayTestRuntimeDependencies,
): Promise<ReplaySuiteTestResult[]> {
  const {
    entries,
    sessionName,
    suiteInvocationId,
    cwd,
    requestId,
    flags,
    suiteArtifactsDir,
    suiteTotal,
    shard,
    runReplay,
    cleanupSession,
    finalizeAttempt,
  } = params;
  const results: ReplaySuiteTestResult[] = [];
  for (const [entryIndex, entry] of entries.entries()) {
    const result = await runReplayTestCase({
      entry,
      sessionName,
      suiteInvocationId,
      caseIndex: entryIndex,
      cwd,
      requestId,
      retries: resolveReplayTestRetries(flags?.retries, entry.metadata.retries),
      timeoutMs: resolveReplayTestTimeout(flags?.timeoutMs, entry.metadata.timeoutMs),
      suiteArtifactsDir,
      suiteIndex: entryIndex + 1,
      suiteTotal,
      shard,
      runReplay,
      cleanupSession,
      finalizeAttempt,
    });
    results.push(result);
    if (flags?.failFast === true || isReplayInfrastructureFailure(result)) break;
  }
  return results;
}

// fallow-ignore-next-line complexity
async function runReplayTestCase(
  params: {
    entry: ReplayTestRunEntry;
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
    shard?: ReplayTestShardContext;
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
    shard,
    runReplay,
    cleanupSession,
    finalizeAttempt,
  } = params;
  const testStartedAt = Date.now();
  const testArtifactsDir = path.join(
    suiteArtifactsDir,
    ...(shard ? [`shard-${shard.shardIndex + 1}`] : []),
    buildReplayTestArtifactSlug(entry.path, cwd),
  );
  let finalResponse: DaemonResponse | undefined;
  let finalSessionName = '';
  let attempts = 0;
  let finalAttemptDurationMs = 0;
  const attemptFailures: NonNullable<
    Extract<ReplaySuiteTestResult, { status: 'passed' }>['attemptFailures']
  > = [];

  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    attempts = attemptIndex + 1;
    const attemptStartedAt = Date.now();
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
      shardIndex: shard?.shardIndex,
    });
    const response = await runReplayTestAttempt({
      filePath: entry.path,
      sessionName: testSessionName,
      requestId: attemptRequestId,
      timeoutMs,
      platform: entry.metadata.platform,
      target: entry.metadata.target,
      artifactsDir: attemptArtifactsDir,
      shard,
      runReplay,
      cleanupSession,
      finalizeAttempt,
    });
    finalAttemptDurationMs = Date.now() - attemptStartedAt;
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
    attemptFailures.push({
      attempt: attempts,
      message: response.error.message,
      durationMs: finalAttemptDurationMs,
    });
    if (isReplayInfrastructureFailure(response)) break;
    if (attemptIndex >= retries) break;
    emitRequestProgress({
      type: 'replay-test',
      file: entry.path,
      title: entry.title,
      status: 'fail',
      index: suiteIndex,
      total: suiteTotal,
      attempt: attempts,
      maxAttempts: retries + 1,
      durationMs: finalAttemptDurationMs,
      retrying: true,
      message: response.error.message,
    });
  }

  const durationMs = Date.now() - testStartedAt;
  if (finalResponse?.ok) {
    emitRequestProgress({
      type: 'replay-test',
      file: entry.path,
      title: entry.title,
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
      title: entry.title,
      session: finalSessionName,
      status: 'passed',
      durationMs,
      finalAttemptDurationMs,
      attempts,
      artifactsDir: testArtifactsDir,
      replayed: typeof finalResponse.data?.replayed === 'number' ? finalResponse.data.replayed : 0,
      healed: typeof finalResponse.data?.healed === 'number' ? finalResponse.data.healed : 0,
      ...replayTestWarningsResultMetadata(finalResponse.data?.warnings),
      ...replayTestShardResultMetadata(shard),
      ...(attemptFailures.length > 0 ? { attemptFailures } : {}),
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
    title: entry.title,
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
    title: entry.title,
    session: finalSessionName,
    status: 'failed',
    durationMs,
    attempts,
    artifactsDir: testArtifactsDir,
    error,
    ...replayTestShardResultMetadata(shard),
  };
}

function replayTestWarningsResultMetadata(
  warnings: unknown,
): Pick<Extract<ReplaySuiteTestResult, { status: 'passed' }>, 'warnings'> {
  if (!Array.isArray(warnings)) return {};
  const filtered = warnings.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? { warnings: filtered } : {};
}

function replayTestShardResultMetadata(
  shard: ReplayTestShardContext | undefined,
): Pick<ReplaySuiteTestFailed, 'shardIndex' | 'shardCount' | 'deviceId'> {
  return shard
    ? {
        shardIndex: shard.shardIndex,
        shardCount: shard.shardCount,
        deviceId: shard.device.id,
      }
    : {};
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
