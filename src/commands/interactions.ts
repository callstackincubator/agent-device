import { AppError } from '../utils/errors.ts';
import type { Point, SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { centerOfRect, findNodeByRef, normalizeRef } from '../utils/snapshot.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime.ts';
import { formatSelectorFailure, parseSelectorChain, resolveSelectorChain } from '../selectors.ts';
import { buildSelectorChainForNode } from '../daemon/selectors-build.ts';
import { findNodeByLabel, isFillableType, resolveRefLabel } from '../daemon/snapshot-processing.ts';
import {
  isNodeVisibleInEffectiveViewport,
  resolveEffectiveViewportRect,
} from '../utils/mobile-snapshot-semantics.ts';
import { resolveActionableTouchNode } from './interaction-targeting.ts';
import type { ElementTarget, ResolvedTarget } from './selector-read.ts';
import { now, toBackendContext } from './selector-read-utils.ts';
import type { RuntimeCommand } from './index.ts';

export type PointTarget = {
  kind: 'point';
  x: number;
  y: number;
};

export type InteractionTarget = ElementTarget | PointTarget;

export type PressCommandOptions = CommandContext & {
  target: InteractionTarget;
  button?: 'primary' | 'secondary' | 'middle';
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};

export type ClickCommandOptions = PressCommandOptions;

export type PressCommandResult = {
  kind: 'point' | 'ref' | 'selector';
  point: Point;
  target?: ResolvedTarget;
  node?: SnapshotNode;
  selectorChain?: string[];
  refLabel?: string;
  backendResult?: Record<string, unknown>;
};

export type FillCommandOptions = CommandContext & {
  target: InteractionTarget;
  text: string;
  delayMs?: number;
};

export type FillCommandResult = {
  kind: 'point' | 'ref' | 'selector';
  point: Point;
  text: string;
  target?: ResolvedTarget;
  node?: SnapshotNode;
  selectorChain?: string[];
  refLabel?: string;
  warning?: string;
  backendResult?: Record<string, unknown>;
};

type CapturedSnapshot = {
  snapshot: SnapshotState;
};

export const pressCommand: RuntimeCommand<PressCommandOptions, PressCommandResult> = async (
  runtime,
  options,
): Promise<PressCommandResult> => {
  const resolved = await resolveInteractionTarget(runtime, options, {
    action: 'click',
    requireInteractive: true,
    promoteToHittableAncestor: true,
  });
  if (!runtime.backend.tap) {
    throw new AppError('UNSUPPORTED_OPERATION', 'tap is not supported by this backend');
  }
  const backendResult = await runtime.backend.tap(
    toBackendContext(runtime, options),
    resolved.point,
    {
      button: options.button,
      count: options.count,
      intervalMs: options.intervalMs,
      holdMs: options.holdMs,
      jitterPx: options.jitterPx,
      doubleTap: options.doubleTap,
    },
  );
  return {
    ...resolved,
    ...(toBackendResult(backendResult) ? { backendResult: toBackendResult(backendResult) } : {}),
  };
};

export const clickCommand = pressCommand satisfies RuntimeCommand<
  ClickCommandOptions,
  PressCommandResult
>;

export const fillCommand: RuntimeCommand<FillCommandOptions, FillCommandResult> = async (
  runtime,
  options,
): Promise<FillCommandResult> => {
  if (!options.text) throw new AppError('INVALID_ARGS', 'fill requires text');
  const resolved = await resolveInteractionTarget(runtime, options, {
    action: 'fill',
    requireInteractive: true,
    promoteToHittableAncestor: false,
  });
  if (!runtime.backend.fill) {
    throw new AppError('UNSUPPORTED_OPERATION', 'fill is not supported by this backend');
  }
  const backendResult = await runtime.backend.fill(
    toBackendContext(runtime, options),
    resolved.point,
    options.text,
    { delayMs: options.delayMs },
  );
  const nodeType = resolved.node?.type ?? '';
  const warning =
    nodeType && !isFillableType(nodeType, runtime.backend.platform)
      ? `fill target ${formatTargetForWarning(resolved)} resolved to "${nodeType}", attempting fill anyway.`
      : undefined;
  return {
    ...resolved,
    text: options.text,
    ...(warning ? { warning } : {}),
    ...(toBackendResult(backendResult) ? { backendResult: toBackendResult(backendResult) } : {}),
  };
};

async function resolveInteractionTarget(
  runtime: AgentDeviceRuntime,
  options: CommandContext & { target: InteractionTarget },
  params: {
    action: 'click' | 'fill';
    requireInteractive: boolean;
    promoteToHittableAncestor: boolean;
  },
): Promise<Omit<PressCommandResult, 'backendResult'>> {
  if (options.target.kind === 'point') {
    return {
      kind: 'point',
      point: { x: options.target.x, y: options.target.y },
    };
  }

  if (options.target.kind === 'ref') {
    const capture = await resolveSnapshotForRef(runtime, options, options.target);
    const resolved = capture.resolved;
    const node = params.promoteToHittableAncestor
      ? resolveActionableTouchNode(capture.snapshot.nodes, resolved.node)
      : resolved.node;
    assertVisibleRefTarget(node, capture.snapshot.nodes, options.target.ref, params.action);
    const point = resolveNodeCenter(
      node,
      `Ref ${options.target.ref} not found or has invalid bounds`,
    );
    return {
      kind: 'ref',
      point,
      target: { kind: 'ref', ref: `@${resolved.ref}` },
      node,
      selectorChain: buildSelectorChainForNode(node, runtime.backend.platform, {
        action: params.action,
      }),
      refLabel: resolveRefLabel(node, capture.snapshot.nodes),
    };
  }

  const capture = await captureInteractionSnapshot(runtime, options, params.requireInteractive);
  const chain = parseSelectorChain(options.target.selector);
  const resolved = resolveSelectorChain(capture.snapshot.nodes, chain, {
    platform: runtime.backend.platform,
    requireRect: true,
    requireUnique: true,
    disambiguateAmbiguous: true,
  });
  if (!resolved || !resolved.node.rect) {
    throw new AppError(
      'COMMAND_FAILED',
      formatSelectorFailure(chain, resolved?.diagnostics ?? [], { unique: true }),
    );
  }
  const node = params.promoteToHittableAncestor
    ? resolveActionableTouchNode(capture.snapshot.nodes, resolved.node)
    : resolved.node;
  const point = resolveNodeCenter(
    node,
    `Selector ${resolved.selector.raw} resolved to invalid bounds`,
  );
  return {
    kind: 'selector',
    point,
    target: { kind: 'selector', selector: resolved.selector.raw },
    node,
    selectorChain: buildSelectorChainForNode(node, runtime.backend.platform, {
      action: params.action,
    }),
    refLabel: resolveRefLabel(node, capture.snapshot.nodes),
  };
}

async function captureInteractionSnapshot(
  runtime: AgentDeviceRuntime,
  options: CommandContext,
  interactiveOnly: boolean,
): Promise<CapturedSnapshot> {
  if (!runtime.backend.captureSnapshot) {
    throw new AppError('UNSUPPORTED_OPERATION', 'snapshot is not supported by this backend');
  }
  const sessionName = options.session ?? 'default';
  const session = await runtime.sessions.get(sessionName);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'No active session. Run open first.');
  const result = await runtime.backend.captureSnapshot(toBackendContext(runtime, options), {
    interactiveOnly,
    compact: interactiveOnly,
  });
  const snapshot =
    result.snapshot ??
    ({
      nodes: result.nodes ?? [],
      truncated: result.truncated,
      backend: result.backend as SnapshotState['backend'],
      createdAt: now(runtime),
    } satisfies SnapshotState);
  await runtime.sessions.set({ ...session, snapshot });
  return { snapshot };
}

async function resolveSnapshotForRef(
  runtime: AgentDeviceRuntime,
  options: CommandContext,
  target: Extract<InteractionTarget, { kind: 'ref' }>,
): Promise<CapturedSnapshot & { resolved: { ref: string; node: SnapshotNode } }> {
  const sessionName = options.session ?? 'default';
  const session = await runtime.sessions.get(sessionName);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'No active session. Run open first.');
  if (!session.snapshot) {
    throw new AppError('INVALID_ARGS', 'No snapshot in session. Run snapshot first.');
  }

  const fallbackLabel = target.fallbackLabel ?? '';
  const stored = tryResolveRefNode(session.snapshot.nodes, target.ref, {
    fallbackLabel,
    requireRect: true,
  });
  if (stored) {
    return { snapshot: session.snapshot, resolved: stored };
  }

  const capture = await captureInteractionSnapshot(runtime, options, true);
  return {
    ...capture,
    resolved: resolveRefNode(capture.snapshot.nodes, target.ref, {
      fallbackLabel,
      requireRect: true,
    }),
  };
}

function tryResolveRefNode(
  nodes: SnapshotState['nodes'],
  refInput: string,
  options: {
    fallbackLabel: string;
    requireRect: boolean;
  },
): { ref: string; node: SnapshotNode } | null {
  const ref = normalizeRef(refInput);
  if (!ref) throw new AppError('INVALID_ARGS', `Invalid ref: ${refInput}`);
  const refNode = findNodeByRef(nodes, ref);
  if (isUsableResolvedNode(refNode, options.requireRect)) return { ref, node: refNode };
  const fallbackNode =
    options.fallbackLabel.length > 0 ? findNodeByLabel(nodes, options.fallbackLabel) : null;
  if (isUsableResolvedNode(fallbackNode, options.requireRect)) {
    return { ref, node: fallbackNode };
  }
  return null;
}

function resolveRefNode(
  nodes: SnapshotState['nodes'],
  refInput: string,
  options: {
    fallbackLabel: string;
    requireRect: boolean;
  },
): { ref: string; node: SnapshotNode } {
  const resolved = tryResolveRefNode(nodes, refInput, options);
  if (!resolved) {
    throw new AppError('COMMAND_FAILED', `Ref ${refInput} not found or has no bounds`);
  }
  return resolved;
}

function resolveNodeCenter(node: SnapshotNode, message: string): Point {
  if (!node.rect) throw new AppError('COMMAND_FAILED', message);
  const point = centerOfRect(node.rect);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new AppError('COMMAND_FAILED', message);
  }
  return point;
}

function isUsableResolvedNode(
  node: SnapshotNode | null | undefined,
  requireRect: boolean,
): node is SnapshotNode {
  if (!node) return false;
  if (!requireRect) return true;
  if (!node.rect) return false;
  const { x, y, width, height } = node.rect;
  if (
    !Number.isFinite(Number(x)) ||
    !Number.isFinite(Number(y)) ||
    !Number.isFinite(Number(width)) ||
    !Number.isFinite(Number(height)) ||
    Number(width) < 0 ||
    Number(height) < 0
  ) {
    return false;
  }
  const point = centerOfRect(node.rect);
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function assertVisibleRefTarget(
  node: SnapshotNode,
  nodes: SnapshotState['nodes'],
  refInput: string,
  action: 'click' | 'fill',
): void {
  const viewport = node.rect ? resolveEffectiveViewportRect(node, nodes) : null;
  if (!node.rect || !viewport || isNodeVisibleInEffectiveViewport(node, nodes)) return;
  throw new AppError('COMMAND_FAILED', `Ref ${refInput} is off-screen and not safe to ${action}`, {
    reason: 'offscreen_ref',
    ref: normalizeRef(refInput),
    rect: node.rect,
    viewport,
    hint: `Use scroll with the direction from the off-screen summary, take a fresh snapshot, then retry ${action} with the new ref or a selector.`,
  });
}

function toBackendResult(result: unknown): Record<string, unknown> | undefined {
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
}

function formatTargetForWarning(result: Pick<FillCommandResult, 'kind' | 'target'>): string {
  if (result.target?.kind === 'ref') return result.target.ref;
  if (result.target?.kind === 'selector') return result.target.selector;
  return 'point';
}
