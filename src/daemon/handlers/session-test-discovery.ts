import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../utils/errors.ts';
import type { PlatformSelector } from '../../utils/device.ts';
import { resolveRequestTrackingId } from '../request-cancel.ts';
import { SessionStore } from '../session-store.ts';
import { readReplayScriptMetadata, type ReplayScriptMetadata } from './session-replay-script.ts';

const GLOB_PATTERN_CHARS = /[*?[\]{}]/;

const MAX_REPLAY_TEST_RETRIES = 3;

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

export function buildReplayTestInvocationId(requestId?: string): string {
  const raw = requestId?.trim() || `${process.pid}-${Date.now().toString(36)}`;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'suite';
}

export function buildReplayTestAttemptRequestId(params: {
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

export function resolveReplayTestTimeout(
  cliTimeoutMs: unknown,
  metadataTimeoutMs: number | undefined,
): number | undefined {
  return typeof cliTimeoutMs === 'number' ? cliTimeoutMs : metadataTimeoutMs;
}

export function resolveReplayTestRetries(
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
