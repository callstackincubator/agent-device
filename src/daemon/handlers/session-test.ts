import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { AppError, asAppError } from '../../utils/errors.ts';
import type { PlatformSelector } from '../../utils/device.ts';
import {
  clearRequestCanceled,
  markRequestCanceled,
  registerRequestAbort,
  resolveRequestTrackingId,
} from '../request-cancel.ts';
import type {
  DaemonRequest,
  DaemonResponse,
  ReplaySuiteResult,
  ReplaySuiteTestFailed,
  ReplaySuiteTestResult,
} from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { readReplayScriptMetadata, type ReplayScriptMetadata } from './session-replay-script.ts';

const GLOB_PATTERN_CHARS = /[*?[\]{}]/;
const DEFAULT_TEST_ARTIFACTS_ROOT = '.agent-device/test-artifacts';
const MAX_REPLAY_TEST_RETRIES = 3;
const REPLAY_TIMEOUT_CLEANUP_GRACE_MS = 2_000;

export type ReplayTestDiscoveryEntry =
  | {
      kind: 'run';
      path: string;
      metadata: ReplayScriptMetadata;
    }
  | {
      kind: 'skip';
      path: string;
      reason: 'skipped-by-filter';
      message: string;
    };

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
      if (req.flags?.failFast === true) {
        break;
      }
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

export function discoverReplayTestEntries(params: {
  inputs: string[];
  cwd?: string;
  platformFilter?: PlatformSelector;
}): ReplayTestDiscoveryEntry[] {
  const { inputs, cwd, platformFilter } = params;
  const resolvedCwd = cwd ?? process.cwd();
  const filePaths = [
    ...new Set(inputs.flatMap((input) => expandReplayTestInput(input, resolvedCwd))),
  ]
    .map((entry) => path.normalize(entry))
    .sort((left, right) => left.localeCompare(right));

  const entries: ReplayTestDiscoveryEntry[] = [];
  for (const filePath of filePaths) {
    const script = fs.readFileSync(filePath, 'utf8');
    const metadata = readReplayScriptMetadata(script);
    if (!platformFilter) {
      entries.push({ kind: 'run', path: filePath, metadata });
      continue;
    }
    if (!metadata.platform) {
      entries.push({
        kind: 'skip',
        path: filePath,
        reason: 'skipped-by-filter',
        message: `missing platform metadata for --platform ${platformFilter}`,
      });
      continue;
    }
    if (!matchesPlatformFilter(platformFilter, metadata.platform)) {
      continue;
    }
    entries.push({ kind: 'run', path: filePath, metadata });
  }

  const runnableCount = entries.filter((entry) => entry.kind === 'run').length;
  if (runnableCount === 0) {
    const suffix = platformFilter ? ` for --platform ${platformFilter}` : '';
    throw new AppError('INVALID_ARGS', `No .ad tests matched${suffix}.`);
  }

  return entries;
}

export function buildReplayTestSessionName(
  sessionName: string,
  suiteInvocationId: string,
  filePath: string,
  caseIndex: number,
  attemptIndex = 0,
): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const testNumber = caseIndex + 1;
  return `${sessionName}:test:${suiteInvocationId}:${testNumber}${slug ? `-${slug}` : ''}:attempt-${attemptIndex + 1}`;
}

function buildReplayTestInvocationId(requestId?: string): string {
  const raw = requestId?.trim() || `${process.pid}-${Date.now().toString(36)}`;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'suite';
}

function buildReplayTestAttemptRequestId(params: {
  requestId?: string;
  suiteInvocationId: string;
  filePath: string;
  caseIndex: number;
  attemptIndex: number;
}): string {
  const { requestId, suiteInvocationId, filePath, caseIndex, attemptIndex } = params;
  return resolveRequestTrackingId(
    `${requestId ?? suiteInvocationId}:test:${caseIndex + 1}:${path.basename(filePath)}:attempt:${attemptIndex + 1}`,
    suiteInvocationId,
  );
}

async function runReplayTestAttempt(params: {
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
      details: {
        reason: 'timeout',
        timeoutMs,
        artifactPaths,
      },
    },
  };
}

function resolveReplayTestArtifactsDir(params: {
  artifactsDir?: string;
  cwd?: string;
  suiteInvocationId: string;
}): string {
  const { artifactsDir, cwd, suiteInvocationId } = params;
  const resolvedRoot = SessionStore.expandHome(artifactsDir ?? DEFAULT_TEST_ARTIFACTS_ROOT, cwd);
  return path.join(resolvedRoot, suiteInvocationId);
}

function buildReplayTestArtifactSlug(filePath: string, cwd?: string): string {
  const relativePath = cwd ? path.relative(cwd, filePath) : path.basename(filePath);
  const value =
    relativePath.length === 0 || relativePath.startsWith('..')
      ? path.basename(filePath)
      : relativePath;
  return (
    value
      .toLowerCase()
      .replace(/[\\/]+/g, '__')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'test'
  );
}

function prepareReplayTestAttemptArtifacts(filePath: string, attemptArtifactsDir: string): void {
  fs.mkdirSync(attemptArtifactsDir, { recursive: true });
  fs.copyFileSync(filePath, path.join(attemptArtifactsDir, 'replay.ad'));
}

function materializeReplayTestAttemptArtifacts(params: {
  response: DaemonResponse;
  filePath: string;
  sessionName: string;
  attempts: number;
  maxAttempts: number;
  attemptArtifactsDir: string;
}): void {
  const { response, filePath, sessionName, attempts, maxAttempts, attemptArtifactsDir } = params;
  const artifactPaths = getReplayTestArtifactPaths(response);
  const copiedArtifacts = copyReplayTestArtifacts(artifactPaths, attemptArtifactsDir);
  if (response.ok) return;
  if (typeof response.error.logPath === 'string') {
    copyReplayTestArtifacts([response.error.logPath], attemptArtifactsDir);
  }
  const lines = [
    `file: ${filePath}`,
    `session: ${sessionName}`,
    `attempt: ${attempts}/${maxAttempts}`,
    `code: ${response.error.code}`,
    `message: ${response.error.message}`,
  ];
  if (response.error.hint) lines.push(`hint: ${response.error.hint}`);
  if (response.error.diagnosticId) lines.push(`diagnosticId: ${response.error.diagnosticId}`);
  if (response.error.logPath) lines.push(`logPath: ${response.error.logPath}`);
  if (copiedArtifacts.length > 0) {
    lines.push(
      `copiedArtifacts: ${copiedArtifacts.map((entry) => path.basename(entry)).join(', ')}`,
    );
  }
  fs.writeFileSync(path.join(attemptArtifactsDir, 'failure.txt'), `${lines.join('\n')}\n`);
}

function getReplayTestArtifactPaths(response: DaemonResponse): string[] {
  const raw = response.ok
    ? (response.data as Record<string, unknown> | undefined)?.artifactPaths
    : response.error.details?.artifactPaths;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((entry): entry is string => typeof entry === 'string'))];
}

function copyReplayTestArtifacts(paths: string[], attemptArtifactsDir: string): string[] {
  const copiedPaths: string[] = [];
  const usedNames = new Map<string, number>();
  for (const sourcePath of paths) {
    if (!isExistingFile(sourcePath)) continue;
    const fileName = buildUniqueArtifactFileName(path.basename(sourcePath), usedNames);
    const destinationPath = path.join(attemptArtifactsDir, fileName);
    if (path.resolve(sourcePath) !== path.resolve(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
    copiedPaths.push(destinationPath);
  }
  return copiedPaths;
}

function buildUniqueArtifactFileName(fileName: string, usedNames: Map<string, number>): string {
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  const current = usedNames.get(fileName) ?? 0;
  usedNames.set(fileName, current + 1);
  if (current === 0) return fileName;
  return `${stem}-${current + 1}${extension}`;
}

function resolveReplayTestTimeout(
  cliTimeoutMs: unknown,
  metadataTimeoutMs: number | undefined,
): number | undefined {
  return typeof cliTimeoutMs === 'number' ? cliTimeoutMs : metadataTimeoutMs;
}

function resolveReplayTestRetries(
  cliRetries: unknown,
  metadataRetries: number | undefined,
): number {
  const resolved = typeof cliRetries === 'number' ? cliRetries : metadataRetries;
  if (typeof resolved !== 'number') return 0;
  return Math.max(0, Math.min(MAX_REPLAY_TEST_RETRIES, resolved));
}

function expandReplayTestInput(input: string, cwd: string): string[] {
  const expandedInput = SessionStore.expandHome(input, cwd);
  if (fs.existsSync(expandedInput)) {
    const stat = fs.statSync(expandedInput);
    if (stat.isDirectory()) {
      return fs
        .globSync('**/*.ad', { cwd: expandedInput })
        .map((match) => path.join(expandedInput, match));
    }
    if (stat.isFile()) {
      if (path.extname(expandedInput) !== '.ad') {
        throw new AppError('INVALID_ARGS', `test requires .ad files. Received: ${input}`);
      }
      return [expandedInput];
    }
    return [];
  }

  if (!looksLikeGlob(input) && !looksLikeGlob(expandedInput)) {
    throw new AppError('INVALID_ARGS', `test input not found: ${input}`);
  }

  const pattern = path.isAbsolute(expandedInput) ? expandedInput : input;
  const matches = fs.globSync(pattern, {
    cwd: path.isAbsolute(expandedInput) ? undefined : cwd,
  });

  return matches
    .map((match) => (path.isAbsolute(match) ? match : path.resolve(cwd, match)))
    .filter((match) => path.extname(match) === '.ad' && isExistingFile(match));
}

function looksLikeGlob(value: string): boolean {
  return GLOB_PATTERN_CHARS.test(value);
}

function matchesPlatformFilter(filter: PlatformSelector, candidate: PlatformSelector): boolean {
  if (filter === 'apple') {
    return candidate === 'apple' || candidate === 'ios' || candidate === 'macos';
  }
  return candidate === filter;
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
