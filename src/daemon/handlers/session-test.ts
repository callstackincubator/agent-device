import { asAppError, normalizeError } from '../../utils/errors.ts';
import { errorResponse } from './response.ts';
import type {
  DaemonRequest,
  DaemonResponse,
  ReplaySuiteResult,
  ReplaySuiteTestFailed,
  ReplaySuiteTestResult,
} from '../types.ts';
import { resolveReplayTestArtifactsDir } from './session-test-artifacts.ts';
import { emitRequestProgress } from '../request-progress.ts';
import {
  buildReplayTestInvocationId,
  discoverReplayTestEntries,
  type ReplayTestRunEntry,
  resolveReplayTestRetries,
  resolveReplayTestTimeout,
} from './session-test-discovery.ts';
import { isReplayInfrastructureFailure } from './session-test-infrastructure.ts';
import { runReplayTestCase } from './session-test-attempt.ts';
import type { ReplayTestRuntimeDependencies } from './session-test-types.ts';
import { buildReplayTestShardPlan, type ReplayTestShardContext } from './session-test-sharding.ts';

type ReplayTestEntry = ReturnType<typeof discoverReplayTestEntries>[number];

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
