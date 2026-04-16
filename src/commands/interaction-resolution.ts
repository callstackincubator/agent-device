import { AppError } from '../utils/errors.ts';
import type { Point, SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { centerOfRect, findNodeByRef, normalizeRef } from '../utils/snapshot.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime.ts';
import { formatSelectorFailure, parseSelectorChain, resolveSelectorChain } from '../selectors.ts';
import { buildSelectorChainForNode } from '../utils/selector-build.ts';
import { findNodeByLabel, resolveRefLabel } from '../utils/snapshot-processing.ts';
import {
  isNodeVisibleInEffectiveViewport,
  resolveEffectiveViewportRect,
} from '../utils/mobile-snapshot-semantics.ts';
import { resolveActionableTouchNode } from './interaction-targeting.ts';
import type { ElementTarget, ResolvedTarget } from './selector-read.ts';
import { now, toBackendContext } from './selector-read-utils.ts';

export type PointTarget = {
  kind: 'point';
  x: number;
  y: number;
};

export type InteractionTarget = ElementTarget | PointTarget;

export type ResolvedInteractionTarget =
  | {
      kind: 'point';
      point: Point;
    }
  | {
      kind: 'ref';
      point: Point;
      target: Extract<ResolvedTarget, { kind: 'ref' }>;
      node: SnapshotNode;
      selectorChain: string[];
      refLabel?: string;
    }
  | {
      kind: 'selector';
      point: Point;
      target: Extract<ResolvedTarget, { kind: 'selector' }>;
      node: SnapshotNode;
      selectorChain: string[];
      refLabel?: string;
    };

export type InteractionAction =
  | 'click'
  | 'press'
  | 'fill'
  | 'focus'
  | 'longPress'
  | 'scroll'
  | 'swipe'
  | 'pinch';

export type CapturedSnapshot = {
  snapshot: SnapshotState;
};

export async function resolveInteractionTarget(
  runtime: AgentDeviceRuntime,
  options: CommandContext & { target: InteractionTarget },
  params: {
    action: InteractionAction;
    requireInteractive: boolean;
    promoteToHittableAncestor: boolean;
  },
): Promise<ResolvedInteractionTarget> {
  await assertSupportedInteractionSurface(runtime, options, params.action);

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
        action: params.action === 'fill' ? 'fill' : 'click',
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
      action: params.action === 'fill' ? 'fill' : 'click',
    }),
    refLabel: resolveRefLabel(node, capture.snapshot.nodes),
  };
}

export async function captureInteractionSnapshot(
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

export async function assertSupportedInteractionSurface(
  runtime: AgentDeviceRuntime,
  options: CommandContext,
  action: InteractionAction,
): Promise<void> {
  if (runtime.backend.platform !== 'macos') return;
  const surface = await resolveInteractionSurface(runtime, options);
  if (surface !== 'desktop' && surface !== 'menubar') return;
  // Menu bar button activation is supported by the existing daemon path; text entry is not.
  if (surface === 'menubar' && (action === 'click' || action === 'press')) return;
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    `${action} is not supported on macOS ${surface} sessions yet. Open an app session to act, or use the ${surface} surface to inspect.`,
  );
}

async function resolveInteractionSurface(
  runtime: AgentDeviceRuntime,
  options: CommandContext,
): Promise<unknown> {
  const session = await runtime.sessions.get(options.session ?? 'default');
  return session?.metadata?.surface;
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
  const refreshed = tryResolveRefNode(capture.snapshot.nodes, target.ref, {
    fallbackLabel,
    requireRect: true,
  });
  if (!refreshed) {
    throw new AppError('COMMAND_FAILED', `Ref ${target.ref} not found or has no bounds`);
  }
  return { ...capture, resolved: refreshed };
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
  action: InteractionAction,
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
