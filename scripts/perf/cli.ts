import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolveCliArgv, REPO_ROOT } from './config.ts';
import type { BatchStepSpec } from './scenario.ts';
import type { CliResult } from './types.ts';

const MAX_BUFFER = 64 * 1024 * 1024;
const CLI_ARGV = resolveCliArgv();

function tryParseJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some commands print a trailing line after JSON; try the last JSON-looking block.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function jsonOk(json: unknown): boolean {
  return !(json !== null && typeof json === 'object' && (json as { ok?: unknown }).ok === false);
}

// Invoke the built CLI once. `args` includes the command + positionals + dash-flags;
// `baseFlags` carries the isolation + device flags shared by every call.
export function invokeCli(args: string[], baseFlags: string[]): CliResult {
  const full = [...CLI_ARGV, ...args, ...baseFlags, '--json'];
  const t0 = performance.now();
  const r = spawnSync(process.execPath, full, {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: MAX_BUFFER,
  });
  const wallClockMs = performance.now() - t0;
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const json = tryParseJson(stdout);
  const exitCode = r.status ?? -1;
  return { exitCode, wallClockMs, stdout, stderr, json, ok: exitCode === 0 && jsonOk(json) };
}

// Wrap a single command in its own `batch` invocation to read per-step durationMs.
export function invokeBatchStep(spec: BatchStepSpec, baseFlags: string[]): CliResult {
  return invokeCli(['batch', '--steps', JSON.stringify([spec])], baseFlags);
}

function firstBatchResult(json: unknown): Record<string, unknown> | undefined {
  const data = (json as { data?: { results?: unknown[] } } | undefined)?.data;
  const first = data?.results?.[0];
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
}

export function readBatchStepDurationMs(result: CliResult): number | undefined {
  const v = firstBatchResult(result.json)?.durationMs;
  return typeof v === 'number' ? v : undefined;
}

export function readBatchStepError(result: CliResult): { code?: string; message?: string } {
  const err = (result.json as { error?: { code?: string; message?: string } } | undefined)?.error;
  return { code: err?.code, message: err?.message };
}

// Proxy for a11y-tree size: snapshot node count (falls back to distinct @eN refs).
export function countElements(result: CliResult): number | undefined {
  const stepData = firstBatchResult(result.json)?.data;
  if (stepData === undefined || typeof stepData !== 'object') return undefined;
  const nodes = (stepData as { nodes?: unknown }).nodes;
  if (Array.isArray(nodes)) return nodes.length;
  const matches = JSON.stringify(stepData).match(/@e\d+/g);
  return matches ? new Set(matches).size : 0;
}
