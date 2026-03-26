import path from 'node:path';
import { asAppError } from '../../utils/errors.ts';
import type {
  DaemonRequest,
  DaemonResponse,
  ReplaySuiteResult,
  ReplaySuiteTestFailed,
  ReplaySuiteTestResult,
} from '../types.ts';
import type { ReplayScriptMetadata } from './session-replay-script.ts';
import {
  buildReplayTestArtifactSlug,
  materializeReplayTestAttemptArtifacts,
  prepareReplayTestAttemptArtifacts,
  resolveReplayTestArtifactsDir,
} from './session-test-artifacts.ts';
import {
  buildReplayTestAttemptRequestId,
  buildReplayTestInvocationId,
  buildReplayTestSessionName,
  discoverReplayTestEntries,
  resolveReplayTestRetries,
  resolveReplayTestTimeout,
} from './session-test-discovery.ts';
import { runReplayTestAttempt } from './session-test-runtime.ts';

export async function runReplayTestSuite(params: {
  req: DaemonRequest;
  sessionName: string;
  runReplay: (params: {
    filePath: string;
    sessionName: string;
    platform?: ReplayScriptMetadata['platform'];
    requestId?: string;
    artifactPaths?: Set<string>;
  }) => Promise<DaemonResponse>;
  cleanupSession: (sessionName: string) => Promise<void>;
}): Promise<DaemonResponse> {
  const { req, sessionName, runReplay, cleanupSession } = params;
  if ((req.positionals?.length ?? 0) === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: 'test requires at least one path or glob' },
    };
  }

  try {
    const entries = discoverReplayTestEntries({
      inputs: req.positionals,
      cwd: req.meta?.cwd,
      platformFilter: req.flags?.platform,
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
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let executed = 0;

    for (const entry of entries) {
      if (entry.kind === 'skip') {
        skipped += 1;
        results.push({
          file: entry.path,
          status: 'skipped',
          durationMs: 0,
          reason: entry.reason,
          message: entry.message,
        });
        continue;
      }

      const testStartedAt = Date.now();
      const testArtifactsDir = path.join(
        suiteArtifactsDir,
        buildReplayTestArtifactSlug(entry.path, req.meta?.cwd),
      );
      const retries = resolveReplayTestRetries(req.flags?.retries, entry.metadata.retries);
      const timeoutMs = resolveReplayTestTimeout(req.flags?.timeoutMs, entry.metadata.timeoutMs);
      let finalResponse: DaemonResponse | undefined;
      let finalSessionName = '';
      let attempts = 0;

      for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
        attempts = attemptIndex + 1;
        const testSessionName = buildReplayTestSessionName(
          sessionName,
          suiteInvocationId,
          entry.path,
          executed,
          attemptIndex,
        );
        const attemptArtifactsDir = path.join(testArtifactsDir, `attempt-${attempts}`);
        prepareReplayTestAttemptArtifacts(entry.path, attemptArtifactsDir);

        const requestId = buildReplayTestAttemptRequestId({
          requestId: req.meta?.requestId,
          suiteInvocationId,
          filePath: entry.path,
          caseIndex: executed,
          attemptIndex,
        });
        const response = await runReplayTestAttempt({
          filePath: entry.path,
          sessionName: testSessionName,
          requestId,
          timeoutMs,
          platform: entry.metadata.platform,
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
      }

      executed += 1;
      const durationMs = Date.now() - testStartedAt;
      if (finalResponse?.ok) {
        passed += 1;
        results.push({
          file: entry.path,
          session: finalSessionName,
          status: 'passed',
          durationMs,
          attempts,
          artifactsDir: testArtifactsDir,
          replayed:
            typeof finalResponse.data?.replayed === 'number' ? finalResponse.data.replayed : 0,
          healed: typeof finalResponse.data?.healed === 'number' ? finalResponse.data.healed : 0,
        });
        continue;
      }

      const error = finalResponse?.ok
        ? { code: 'COMMAND_FAILED', message: 'Unknown replay test failure' }
        : (finalResponse?.error ?? {
            code: 'COMMAND_FAILED',
            message: 'Unknown replay test failure',
          });
      failed += 1;
      results.push({
        file: entry.path,
        session: finalSessionName,
        status: 'failed',
        durationMs,
        attempts,
        artifactsDir: testArtifactsDir,
        error,
      });
      if (req.flags?.failFast === true) break;
    }

    const data: ReplaySuiteResult = {
      total: entries.length,
      executed,
      passed,
      failed,
      skipped,
      notRun: Math.max(0, entries.length - executed - skipped),
      durationMs: Date.now() - suiteStartedAt,
      failures: results.filter(
        (result): result is ReplaySuiteTestFailed => result.status === 'failed',
      ),
      tests: results,
    };
    return { ok: true, data };
  } catch (err) {
    const appErr = asAppError(err);
    return { ok: false, error: { code: appErr.code, message: appErr.message } };
  }
}
