import type { BackendSnapshotResult } from '../backend.ts';
import type { AgentDeviceRuntime, CommandSessionRecord } from '../runtime.ts';
import { AppError } from '../utils/errors.ts';
import { buildSnapshotDiff, countSnapshotComparableLines } from '../utils/snapshot-diff.ts';
import type { SnapshotNode, SnapshotState, SnapshotVisibility } from '../utils/snapshot.ts';
import { buildSnapshotVisibility } from '../utils/snapshot-visibility.ts';
import type {
  DiffSnapshotCommandOptions,
  RuntimeCommand,
  SnapshotCommandOptions,
} from './index.ts';
import { now } from './selector-read-utils.ts';

export type SnapshotCommandResult = {
  nodes: SnapshotNode[];
  truncated: boolean;
  appName?: string;
  appBundleId?: string;
  visibility?: SnapshotVisibility;
  warnings?: string[];
};

export type SnapshotDiffLine = {
  kind: 'added' | 'removed' | 'unchanged';
  text: string;
};

export type SnapshotDiffSummary = {
  additions: number;
  removals: number;
  unchanged: number;
};

export type DiffSnapshotCommandResult = {
  mode: 'snapshot';
  baselineInitialized: boolean;
  summary: SnapshotDiffSummary;
  lines: SnapshotDiffLine[];
  warnings?: string[];
};

type SnapshotCapture = {
  snapshot: SnapshotState;
  result: BackendSnapshotResult;
  session: CommandSessionRecord | undefined;
  warnings: string[];
};

export const snapshotCommand: RuntimeCommand<
  SnapshotCommandOptions,
  SnapshotCommandResult
> = async (runtime, options): Promise<SnapshotCommandResult> => {
  const capture = await captureRuntimeSnapshot(runtime, options);
  await runtime.sessions.set(nextSnapshotSession(options.session, capture));
  return {
    nodes: capture.snapshot.nodes,
    truncated: capture.snapshot.truncated ?? false,
    visibility: buildSnapshotVisibility({
      nodes: capture.snapshot.nodes,
      backend: capture.snapshot.backend,
      snapshotRaw: options.raw,
    }),
    ...(capture.warnings.length > 0 ? { warnings: capture.warnings } : {}),
    ...snapshotAppFields(capture),
  };
};

export const diffSnapshotCommand: RuntimeCommand<
  DiffSnapshotCommandOptions,
  DiffSnapshotCommandResult
> = async (runtime, options): Promise<DiffSnapshotCommandResult> => {
  const capture = await captureRuntimeSnapshot(runtime, options);
  const flattenForDiff = options.interactiveOnly === true;
  const previousSnapshot = capture.session?.snapshot;
  const nextSession = nextSnapshotSession(options.session, capture);

  if (!previousSnapshot) {
    const unchanged = countSnapshotComparableLines(capture.snapshot.nodes, {
      flatten: flattenForDiff,
    });
    await runtime.sessions.set(nextSession);
    return {
      mode: 'snapshot',
      baselineInitialized: true,
      summary: {
        additions: 0,
        removals: 0,
        unchanged,
      },
      lines: [],
      ...(capture.warnings.length > 0 ? { warnings: capture.warnings } : {}),
    };
  }

  const diff = buildSnapshotDiff(previousSnapshot.nodes, capture.snapshot.nodes, {
    flatten: flattenForDiff,
  });
  await runtime.sessions.set(nextSession);
  return {
    mode: 'snapshot',
    baselineInitialized: false,
    summary: diff.summary,
    lines: diff.lines,
    ...(capture.warnings.length > 0 ? { warnings: capture.warnings } : {}),
  };
};

async function captureRuntimeSnapshot(
  runtime: AgentDeviceRuntime,
  options: SnapshotCommandOptions,
): Promise<SnapshotCapture> {
  if (!runtime.backend.captureSnapshot) {
    throw new AppError('UNSUPPORTED_OPERATION', 'snapshot is not supported by this backend');
  }

  const sessionName = options.session ?? 'default';
  const session = await runtime.sessions.get(sessionName);
  const result = await runtime.backend.captureSnapshot(
    {
      session: sessionName,
      requestId: options.requestId,
      appId: session?.appId,
      appBundleId: session?.appBundleId,
      signal: options.signal ?? runtime.signal,
      metadata: options.metadata,
    },
    {
      interactiveOnly: options.interactiveOnly,
      compact: options.compact,
      depth: options.depth,
      scope: options.scope,
      raw: options.raw,
    },
  );
  const snapshot = normalizeBackendSnapshot(result, runtime);
  const warningTime = now(runtime);
  return {
    snapshot,
    result,
    session,
    warnings: buildSnapshotWarnings({
      result,
      snapshot,
      options,
      session,
      capturedAt: snapshot.createdAt ?? warningTime,
      runtimeNow: warningTime,
    }),
  };
}

function normalizeBackendSnapshot(
  result: BackendSnapshotResult,
  runtime: AgentDeviceRuntime,
): SnapshotState {
  if (result.snapshot) return result.snapshot;
  return {
    nodes: result.nodes ?? [],
    truncated: result.truncated,
    backend: result.backend as SnapshotState['backend'],
    createdAt: now(runtime),
  };
}

function nextSnapshotSession(
  requestedName: string | undefined,
  capture: SnapshotCapture,
): CommandSessionRecord {
  const name = capture.session?.name ?? requestedName ?? 'default';
  return {
    ...(capture.session ?? { name }),
    name,
    snapshot: capture.snapshot,
    appName: capture.result.appName ?? capture.session?.appName,
    appBundleId: capture.result.appBundleId ?? capture.session?.appBundleId,
  };
}

function snapshotAppFields(capture: SnapshotCapture): {
  appName?: string;
  appBundleId?: string;
} {
  const appName = capture.result.appName ?? capture.session?.appName;
  const appBundleId = capture.result.appBundleId ?? capture.session?.appBundleId;
  return {
    ...(appName || appBundleId ? { appName: appName ?? appBundleId } : {}),
    ...(appBundleId ? { appBundleId } : {}),
  };
}

function buildSnapshotWarnings(params: {
  result: BackendSnapshotResult;
  snapshot: SnapshotState;
  options: SnapshotCommandOptions;
  session: CommandSessionRecord | undefined;
  capturedAt: number;
  runtimeNow: number;
}): string[] {
  const warnings = [...(params.result.warnings ?? [])];
  const interactiveOnly = params.options.interactiveOnly === true;
  const analysis = params.result.analysis;

  if (
    params.snapshot.backend === 'android' &&
    interactiveOnly &&
    params.snapshot.nodes.length === 0 &&
    analysis &&
    (analysis.rawNodeCount ?? 0) >= 12
  ) {
    warnings.push(
      `Interactive snapshot is empty after filtering ${analysis.rawNodeCount} raw Android nodes. Likely causes: depth too low, transient route change, or collector filtering.`,
    );
    if (
      typeof params.options.depth === 'number' &&
      typeof analysis.maxDepth === 'number' &&
      analysis.maxDepth >= params.options.depth + 2
    ) {
      warnings.push(
        `Interactive output is empty at depth ${params.options.depth}; retry without -d.`,
      );
    }
  }

  const previousSnapshot = params.session?.snapshot;
  const isRecentSnapshot = previousSnapshot
    ? [params.capturedAt, params.runtimeNow].some((timestamp) => {
        const elapsed = timestamp - previousSnapshot.createdAt;
        return elapsed >= 0 && elapsed <= 2_000;
      })
    : false;
  if (
    !params.result.freshness &&
    previousSnapshot &&
    isRecentSnapshot &&
    isLikelyStaleSnapshotDrop(previousSnapshot.nodes.length, params.snapshot.nodes.length)
  ) {
    warnings.push(
      'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.',
    );
  }

  const freshness = params.result.freshness;
  if (freshness?.staleAfterRetries && params.snapshot.backend === 'android') {
    if (freshness.reason === 'stuck-route') {
      warnings.push(
        `Recent ${freshness.action} was followed by a nearly identical snapshot after ${freshness.retryCount} automatic retr${freshness.retryCount === 1 ? 'y' : 'ies'}. If you expected navigation or submit, the tree may still be stale. Use screenshot as visual truth, wait briefly, then re-snapshot once.`,
      );
    } else if (freshness.reason === 'sharp-drop') {
      warnings.push(
        'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.',
      );
    }
  }

  return Array.from(new Set(warnings));
}

function isLikelyStaleSnapshotDrop(previousCount: number, currentCount: number): boolean {
  if (previousCount < 12) return false;
  return currentCount <= Math.floor(previousCount * 0.2);
}
