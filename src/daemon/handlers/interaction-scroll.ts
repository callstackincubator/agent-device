import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { dispatchCommand } from '../../core/dispatch.ts';
import { DEFAULT_SCROLL_INTO_VIEW_MAX_SCROLLS } from '../../utils/scroll-into-view.ts';
import type { SnapshotNode } from '../../utils/snapshot.ts';
import { successText } from '../../utils/success-text.ts';
import {
  buildSelectorChainForNode,
  parseSelectorChain,
  resolveSelectorChain,
} from '../selectors.ts';
import { findNodeByLabel, resolveRefLabel } from '../snapshot-processing.ts';
import {
  buildScrollIntoViewPlan,
  distanceFromSafeViewportBand,
  resolveViewportRect,
} from '../scroll-planner.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { resolveRefTarget } from './interaction-targeting.ts';

type ScrollRefState = {
  ref: string;
  node: SnapshotNode & { rect: NonNullable<SnapshotNode['rect']> };
  snapshotNodes: SnapshotNode[];
  viewportRect: NonNullable<ReturnType<typeof resolveViewportRect>>;
};

type ScrollNotFoundDetails = {
  message?: string;
  ref?: string;
  stalled?: boolean;
  maxScrolls?: number;
};

export async function handleScrollIntoViewCommand(
  params: InteractionHandlerParams,
): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore, contextFromFlags } = params;
  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }
  if (!isCommandSupportedOnDevice('scrollintoview', session.device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'scrollintoview is not supported on this device',
      },
    };
  }
  const targetInput = req.positionals?.[0] ?? '';
  if (!targetInput.startsWith('@')) {
    return null;
  }
  const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('scrollintoview', req.flags);
  if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
  const fallbackLabel =
    req.positionals && req.positionals.length > 1 ? req.positionals.slice(1).join(' ').trim() : '';
  const initialState = resolveInitialScrollRefState(session, targetInput, fallbackLabel);
  if (!initialState.ok) return initialState.response;

  const { ref } = initialState.state;
  let { node, snapshotNodes, viewportRect } = initialState.state;
  const refLabel = resolveRefLabel(node, snapshotNodes);
  const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
    action: 'get',
  });
  const trackingLabel = fallbackLabel || refLabel || node.label || '';

  if (!buildScrollIntoViewPlan(node.rect, viewportRect)) {
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: {
        ref,
        attempts: 0,
        alreadyVisible: true,
        refLabel,
        selectorChain,
        ...successText(`Scrolled into view: @${ref}`),
      },
    });
    return {
      ok: true,
      data: {
        ref,
        attempts: 0,
        alreadyVisible: true,
        ...successText(`Scrolled into view: @${ref}`),
      },
    };
  }
  const maxScrolls = req.flags?.maxScrolls ?? DEFAULT_SCROLL_INTO_VIEW_MAX_SCROLLS;
  let attempts = 0;
  let stalledCount = 0;
  let lastDirection: 'up' | 'down' | undefined;
  let lastDistance = distanceFromSafeViewportBand(node.rect, viewportRect);
  let data: Record<string, unknown> | void = undefined;

  while (attempts < maxScrolls) {
    const plan = buildScrollIntoViewPlan(node.rect, viewportRect);
    if (!plan) break;
    lastDirection = plan.direction;
    data = await dispatchCommand(
      session.device,
      'swipe',
      [String(plan.x), String(plan.startY), String(plan.x), String(plan.endY), '16'],
      req.flags?.out,
      {
        ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
        count: 1,
        pauseMs: 0,
        pattern: 'one-way',
      },
    );
    attempts += 1;

    await captureSnapshotForSession(session, req.flags, sessionStore, contextFromFlags, {
      interactiveOnly: true,
    });
    const refreshedState = resolveRefreshedScrollRefState({
      session,
      targetInput,
      fallbackLabel: trackingLabel,
      attempts,
      ref,
      selectorChain,
      platform: session.device.platform,
    });
    if (!refreshedState.ok) return refreshedState.response;
    ({ node, snapshotNodes, viewportRect } = refreshedState.state);

    const distance = distanceFromSafeViewportBand(node.rect, viewportRect);
    if (distance === 0) break;
    if (distance >= lastDistance) {
      stalledCount += 1;
      if (stalledCount >= 2) {
        return notFoundScrollResponse(targetInput, attempts, {
          message: `scrollintoview made no progress toward ${targetInput} after ${attempts} scroll${attempts === 1 ? '' : 's'}`,
          ref,
          stalled: true,
        });
      }
    } else {
      stalledCount = 0;
    }
    lastDistance = distance;
  }

  if (distanceFromSafeViewportBand(node.rect, viewportRect) > 0) {
    return notFoundScrollResponse(targetInput, attempts, {
      message: `scrollintoview reached --max-scrolls=${maxScrolls} before ${targetInput} entered view`,
      ref,
      maxScrolls,
    });
  }

  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: {
      ...(data ?? {}),
      ref,
      attempts,
      direction: lastDirection,
      refLabel,
      selectorChain,
      ...successText(`Scrolled into view: @${ref}`),
    },
  });
  return {
    ok: true,
    data: {
      ...(data ?? {}),
      ref,
      attempts,
      direction: lastDirection,
      ...successText(`Scrolled into view: @${ref}`),
    },
  };
}

function resolveInitialScrollRefState(
  session: SessionState,
  targetInput: string,
  fallbackLabel: string,
): { ok: true; state: ScrollRefState } | { ok: false; response: DaemonResponse } {
  const resolvedRefTarget = resolveRefTarget({
    session,
    refInput: targetInput,
    fallbackLabel,
    requireRect: true,
    invalidRefMessage: 'scrollintoview requires a ref like @e2',
    notFoundMessage: `Ref ${targetInput} not found or has no bounds`,
  });
  if (!resolvedRefTarget.ok) {
    const { response } = resolvedRefTarget;
    if (response.ok || response.error.code !== 'COMMAND_FAILED') {
      return { ok: false, response };
    }
    return {
      ok: false,
      response: notFoundScrollResponse(targetInput, 0, {
        message: response.error.message,
      }),
    };
  }
  return finalizeScrollRefState(targetInput, 0, resolvedRefTarget.target);
}

function resolveRefreshedScrollRefState(params: {
  session: SessionState;
  targetInput: string;
  fallbackLabel: string;
  attempts: number;
  ref: string;
  selectorChain: string[];
  platform: SessionState['device']['platform'];
}): { ok: true; state: ScrollRefState } | { ok: false; response: DaemonResponse } {
  const { session, targetInput, fallbackLabel, attempts, ref, selectorChain, platform } = params;
  if (session.snapshot) {
    const trackedNode = resolveTrackedScrollNode(
      session.snapshot.nodes,
      selectorChain,
      fallbackLabel,
      platform,
    );
    if (trackedNode) {
      return finalizeScrollRefState(targetInput, attempts, {
        ref,
        node: trackedNode,
        snapshotNodes: session.snapshot.nodes,
      });
    }
  }

  const resolvedRefTarget = resolveRefTarget({
    session,
    refInput: targetInput,
    fallbackLabel,
    requireRect: true,
    invalidRefMessage: 'scrollintoview requires a ref like @e2',
    notFoundMessage: `Ref ${targetInput} not found or has no bounds`,
  });
  if (!resolvedRefTarget.ok) {
    const { response } = resolvedRefTarget;
    if (response.ok || response.error.code !== 'COMMAND_FAILED') {
      return { ok: false, response };
    }
    return {
      ok: false,
      response: notFoundScrollResponse(targetInput, attempts, {
        message: `scrollintoview lost track of ${targetInput} after ${attempts} scroll${attempts === 1 ? '' : 's'}`,
        ref,
      }),
    };
  }
  return finalizeScrollRefState(targetInput, attempts, resolvedRefTarget.target, {
    ref,
    missingBoundsMessage: `scrollintoview lost bounds for ${targetInput} after ${attempts} scroll${attempts === 1 ? '' : 's'}`,
  });
}

function finalizeScrollRefState(
  targetInput: string,
  attempts: number,
  resolvedTarget: { ref: string; node: SnapshotNode; snapshotNodes: SnapshotNode[] },
  options: { ref?: string; missingBoundsMessage?: string } = {},
): { ok: true; state: ScrollRefState } | { ok: false; response: DaemonResponse } {
  const { ref, missingBoundsMessage } = options;
  const node = resolvedTarget.node;
  if (!node.rect) {
    return {
      ok: false,
      response: notFoundScrollResponse(targetInput, attempts, {
        message: missingBoundsMessage ?? `Ref ${targetInput} not found or has no bounds`,
        ref: ref ?? resolvedTarget.ref,
      }),
    };
  }
  const viewportRect = resolveViewportRect(resolvedTarget.snapshotNodes, node.rect);
  if (!viewportRect) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `scrollintoview could not infer viewport for ${targetInput}`,
        },
      },
    };
  }
  return {
    ok: true,
    state: {
      ref: resolvedTarget.ref,
      node: node as ScrollRefState['node'],
      snapshotNodes: resolvedTarget.snapshotNodes,
      viewportRect,
    },
  };
}

function resolveTrackedScrollNode(
  nodes: SnapshotNode[],
  selectorChain: string[],
  fallbackLabel: string,
  platform: SessionState['device']['platform'],
): SnapshotNode | null {
  for (const selectorExpression of selectorChain) {
    const resolved = resolveSelectorChain(nodes, parseSelectorChain(selectorExpression), {
      platform,
      requireRect: true,
      requireUnique: true,
      disambiguateAmbiguous: true,
    });
    if (resolved?.node.rect) {
      return resolved.node;
    }
  }
  return fallbackLabel ? findNodeByLabel(nodes, fallbackLabel) : null;
}

function notFoundScrollResponse(
  targetInput: string,
  attempts: number,
  details: ScrollNotFoundDetails = {},
): DaemonResponse {
  const { message, ...rest } = details;
  return {
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message:
        typeof message === 'string' ? message : `scrollintoview could not find ${targetInput}`,
      details: {
        reason: 'not_found',
        attempts,
        ...rest,
      },
    },
  };
}
