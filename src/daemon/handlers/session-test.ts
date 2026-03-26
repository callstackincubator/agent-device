import fs from 'node:fs';
import path from 'node:path';
import { AppError, asAppError } from '../../utils/errors.ts';
import type { PlatformSelector } from '../../utils/device.ts';
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

      const testSessionName = buildReplayTestSessionName(sessionName, entry.path, executed);
      const startedAt = Date.now();
      let replayResponse: DaemonResponse;
      try {
        replayResponse = await runReplay({
          filePath: entry.path,
          sessionName: testSessionName,
          platform: entry.metadata.platform,
        });
      } finally {
        await cleanupSession(testSessionName).catch(() => {});
      }
      const durationMs = Date.now() - startedAt;
      executed += 1;

      if (replayResponse.ok) {
        passed += 1;
        results.push({
          file: entry.path,
          session: testSessionName,
          status: 'passed',
          durationMs,
          replayed:
            typeof replayResponse.data?.replayed === 'number' ? replayResponse.data.replayed : 0,
          healed: typeof replayResponse.data?.healed === 'number' ? replayResponse.data.healed : 0,
        });
        continue;
      }

      failed += 1;
      results.push({
        file: entry.path,
        session: testSessionName,
        status: 'failed',
        durationMs,
        error: replayResponse.error,
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
  filePath: string,
  index: number,
): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${sessionName}:test:${index + 1}${slug ? `-${slug}` : ''}`;
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
