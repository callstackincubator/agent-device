import type { BackendSnapshotResult } from '../backend.ts';
import type { AndroidSnapshotBackendMetadata } from '../platforms/android/snapshot-types.ts';
import type { AgentDeviceRuntime, CommandSessionRecord } from '../runtime-contract.ts';
import { AppError } from '../utils/errors.ts';
import { buildSnapshotDiff, countSnapshotComparableLines } from '../utils/snapshot-diff.ts';
import type { SnapshotDiffLine, SnapshotDiffSummary } from '../utils/snapshot-diff.ts';
import type {
  SnapshotNode,
  SnapshotState,
  SnapshotUnchanged,
  SnapshotVisibility,
} from '../utils/snapshot.ts';
import { buildSnapshotVisibility } from '../utils/snapshot-visibility.ts';
import {
  buildUnchangedSnapshotMetadata,
  ensureSnapshotPresentationKey,
} from './snapshot-unchanged.ts';
import type {
  DiffSnapshotCommandOptions,
  RuntimeCommand,
  SnapshotCommandOptions,
} from './runtime-types.ts';
import { now } from './selector-read-utils.ts';

export type { SnapshotDiffLine, SnapshotDiffSummary } from '../utils/snapshot-diff.ts';

export type SnapshotCommandResult = {
  nodes: SnapshotNode[];
  truncated: boolean;
  appName?: string;
  appBundleId?: string;
  visibility?: SnapshotVisibility;
  androidSnapshot?: AndroidSnapshotBackendMetadata;
  warnings?: string[];
  unchanged?: SnapshotUnchanged;
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
  const unchanged = buildUnchangedSnapshotMetadata({
    previous: capture.session?.snapshot,
    current: capture.snapshot,
    options,
    identity: {
      previousAppBundleId: capture.session?.appBundleId,
      currentAppBundleId: capture.result.appBundleId ?? capture.session?.appBundleId,
    },
  });
  await runtime.sessions.set(nextSnapshotSession(options.session, capture));
  return {
    nodes: capture.snapshot.nodes,
    truncated: capture.snapshot.truncated ?? false,
    visibility: buildSnapshotVisibility({
      nodes: capture.snapshot.nodes,
      backend: capture.snapshot.backend,
      snapshotRaw: options.raw,
    }),
    ...(capture.result.androidSnapshot ? { androidSnapshot: capture.result.androidSnapshot } : {}),
    ...(capture.warnings.length > 0 ? { warnings: capture.warnings } : {}),
    ...(unchanged ? { unchanged } : {}),
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
  const snapshot = ensureSnapshotPresentationKey(
    normalizeBackendSnapshot(result, runtime),
    options,
  );
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
  warnings.push(...buildEmptyAndroidInteractiveWarnings(params));

  const helperFallbackWarning = formatAndroidHelperFallbackWarning(params.result.androidSnapshot);
  if (helperFallbackWarning) warnings.push(helperFallbackWarning);

  const reactNativeOverlayWarning = formatReactNativeOverlayWarning(params.snapshot.nodes);
  if (reactNativeOverlayWarning) warnings.push(reactNativeOverlayWarning);

  const recentDropWarning = formatRecentSnapshotDropWarning(params);
  if (recentDropWarning) warnings.push(recentDropWarning);

  warnings.push(...formatFreshnessWarnings(params.result.freshness, params.snapshot.backend));
  return Array.from(new Set(warnings));
}

function buildEmptyAndroidInteractiveWarnings(params: {
  result: BackendSnapshotResult;
  snapshot: SnapshotState;
  options: SnapshotCommandOptions;
}): string[] {
  const analysis = params.result.analysis;
  if (
    params.snapshot.backend !== 'android' ||
    params.options.interactiveOnly !== true ||
    params.snapshot.nodes.length > 0 ||
    !analysis ||
    (analysis.rawNodeCount ?? 0) < 12
  ) {
    return [];
  }

  const warnings = [
    `Interactive snapshot is empty after filtering ${analysis.rawNodeCount} raw Android nodes. Likely causes: the app content is not accessibility-visible yet, a transient route change, or depth/filter options hid the target.`,
  ];
  if (
    typeof params.options.depth === 'number' &&
    typeof analysis.maxDepth === 'number' &&
    analysis.maxDepth >= params.options.depth + 2
  ) {
    warnings.push(
      `Interactive output is empty at depth ${params.options.depth}; retry without -d.`,
    );
  }
  return warnings;
}

function formatAndroidHelperFallbackWarning(
  androidSnapshot: AndroidSnapshotBackendMetadata | undefined,
): string | undefined {
  if (androidSnapshot?.backend !== 'uiautomator-dump') return undefined;
  const reason = androidSnapshot.fallbackReason ? ` Reason: ${androidSnapshot.fallbackReason}` : '';
  return `Android snapshot helper unavailable; using stock UIAutomator dump, which can time out on busy React Native UIs.${reason}`;
}

function formatRecentSnapshotDropWarning(params: {
  result: BackendSnapshotResult;
  snapshot: SnapshotState;
  session: CommandSessionRecord | undefined;
  capturedAt: number;
  runtimeNow: number;
}): string | undefined {
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
    return STALE_SNAPSHOT_DROP_WARNING;
  }
  return undefined;
}

const STALE_SNAPSHOT_DROP_WARNING =
  'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.';

function formatFreshnessWarnings(
  freshness: BackendSnapshotResult['freshness'],
  backend: SnapshotState['backend'],
): string[] {
  if (!freshness?.staleAfterRetries || backend !== 'android') return [];
  if (freshness.reason === 'stuck-route') {
    return [
      `Recent ${freshness.action} was followed by a nearly identical snapshot after ${freshness.retryCount} automatic retr${freshness.retryCount === 1 ? 'y' : 'ies'}. If you expected navigation or submit, the tree may still be stale. Use screenshot as visual truth, wait briefly, then re-snapshot once.`,
    ];
  }
  return freshness.reason === 'sharp-drop' ? [STALE_SNAPSHOT_DROP_WARNING] : [];
}

function isLikelyStaleSnapshotDrop(previousCount: number, currentCount: number): boolean {
  if (previousCount < 12) return false;
  return currentCount <= Math.floor(previousCount * 0.2);
}

function formatReactNativeOverlayWarning(nodes: SnapshotNode[]): string | undefined {
  const overlay = detectReactNativeOverlay(nodes);
  if (!overlay.detected) return undefined;
  if (overlay.redBox) return formatRedBoxOverlayWarning(overlay.minimizeRefs);
  if (overlay.dismissRefs.length > 0) {
    return `Possible React Native warning/error overlay detected. Dismiss before continuing: press ${formatRefList(
      overlay.dismissRefs,
    )}, then snapshot -i and report the warning/error in the final summary. Use screenshot --overlay-refs only if visual evidence is required.`;
  }
  if (overlay.collapsedRefs.length > 0) {
    return `Possible React Native warning/error overlay detected. Warning banner detected. Press ${formatRefList(
      overlay.collapsedRefs,
    )} to expand or clear it; if Dismiss/Close appears, press it, then snapshot -i and report the warning/error in the final summary.`;
  }
  return 'Possible React Native warning/error overlay detected. Dismiss visible Dismiss/Close before continuing, then snapshot -i and report the warning/error in the final summary. Use screenshot --overlay-refs only if visual evidence is required.';
}

type ReactNativeOverlayState = {
  detected: boolean;
  redBox: boolean;
  dismissRefs: string[];
  minimizeRefs: string[];
  collapsedRefs: string[];
};

function detectReactNativeOverlay(nodes: SnapshotNode[]): ReactNativeOverlayState {
  const text = nodes
    .map((node) =>
      [node.label, node.value, node.identifier, node.type, node.role].filter(Boolean).join(' '),
    )
    .join('\n')
    .toLowerCase();

  const dismissRefs = collectOverlayRefs(nodes, isDismissLabel);
  const minimizeRefs = collectOverlayRefs(nodes, isMinimizeLabel);
  const collapsedRefs = collectOverlayRefs(nodes, isCollapsedReactNativeWarningLabel);
  const hasReactNativeStackFrame = isReactNativeStackFrame(text);
  const hasOverlayControl = dismissRefs.length > 0 || minimizeRefs.length > 0;
  const redBox =
    /\b(redbox|runtime error|reload js|copy stack|component stack|call stack)\b/.test(text) ||
    (hasReactNativeStackFrame && hasOverlayControl);
  const detected =
    hasKnownReactNativeOverlayText(text) ||
    collapsedRefs.length > 0 ||
    (hasReactNativeStackFrame && hasOverlayControl);
  return { detected, redBox, dismissRefs, minimizeRefs, collapsedRefs };
}

function formatRedBoxOverlayWarning(minimizeRefs: string[]): string {
  if (minimizeRefs.length > 0) {
    return `Possible React Native warning/error overlay detected. React Native RedBox stack overlay detected. Minimize before continuing: press ${formatRefList(
      minimizeRefs,
    )}, then snapshot -i and report the error in the final summary. Prefer Minimize over Dismiss when the error may re-render immediately.`;
  }
  return 'Possible React Native warning/error overlay detected. React Native RedBox stack overlay detected. Do not press Dismiss if the error may re-render immediately; use screenshot --overlay-refs if visual evidence is required and report the error in the final summary.';
}

function hasKnownReactNativeOverlayText(text: string): boolean {
  return /\b(logbox|redbox|reload js|copy stack|component stack|call stack|runtime error|open debugger to view warnings)\b/.test(
    text,
  );
}

function isReactNativeStackFrame(text: string): boolean {
  return (
    /\b[\w.$<>/-]+\.(?:tsx?|jsx?):\d+(?::\d+)?\b/.test(text) ||
    /\b[\w.$<>/-]+\.(?:tsx?|jsx?)\s+\(\d+:\d+\)/.test(text)
  );
}

function isDismissLabel(label: string): boolean {
  return label === 'dismiss' || label === 'close';
}

function isMinimizeLabel(label: string): boolean {
  return /^minimi[sz]e$/.test(label);
}

function isCollapsedReactNativeWarningLabel(label: string): boolean {
  return (
    label.includes('open debugger to view warnings') ||
    /^!,\s+/.test(label) ||
    /^(warn|warning|error):\s+/.test(label) ||
    /\b(?:possible\s+)?unhandled (?:promise )?rejection\b/.test(label) ||
    label.includes('getsnapshot should be cached to avoid an infinite loop') ||
    label.includes('unique "key" prop') ||
    label.includes("unique 'key' prop") ||
    label.includes('virtualizedlists should never be nested') ||
    label.includes('failed prop type')
  );
}

function collectOverlayRefs(nodes: SnapshotNode[], matches: (label: string) => boolean): string[] {
  const refs: string[] = [];
  for (const node of nodes) {
    if (!node.ref) continue;
    const label = (node.label ?? '').trim().toLowerCase();
    if (!matches(label)) continue;
    refs.push(node.ref);
  }
  return refs;
}

function formatRefList(refs: string[]): string {
  return refs
    .slice(0, 3)
    .map((ref) => `@${ref}`)
    .join(', ');
}
