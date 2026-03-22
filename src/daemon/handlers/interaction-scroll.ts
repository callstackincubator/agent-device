import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { buildSelectorChainForNode } from '../selectors.ts';
import { resolveRefLabel } from '../snapshot-processing.ts';
import { buildScrollIntoViewPlan, resolveViewportRect } from '../scroll-planner.ts';
import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { resolveRefTarget } from './interaction-targeting.ts';

export async function handleScrollIntoViewCommand(
  params: InteractionHandlerParams,
): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore, contextFromFlags, dispatch } = params;
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
  const resolvedRefTarget = resolveRefTarget({
    session,
    refInput: targetInput,
    fallbackLabel,
    requireRect: true,
    invalidRefMessage: 'scrollintoview requires a ref like @e2',
    notFoundMessage: `Ref ${targetInput} not found or has no bounds`,
  });
  if (!resolvedRefTarget.ok) return resolvedRefTarget.response;
  const { ref, node, snapshotNodes } = resolvedRefTarget.target;
  if (!node.rect) {
    return {
      ok: false,
      error: { code: 'COMMAND_FAILED', message: `Ref ${targetInput} not found or has no bounds` },
    };
  }
  const viewportRect = resolveViewportRect(snapshotNodes, node.rect);
  if (!viewportRect) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `scrollintoview could not infer viewport for ${targetInput}`,
      },
    };
  }
  const plan = buildScrollIntoViewPlan(node.rect, viewportRect);
  const refLabel = resolveRefLabel(node, snapshotNodes);
  const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
    action: 'get',
  });
  if (!plan) {
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref, attempts: 0, alreadyVisible: true, refLabel, selectorChain },
    });
    return { ok: true, data: { ref, attempts: 0, alreadyVisible: true } };
  }
  const data = await dispatch(
    session.device,
    'swipe',
    [String(plan.x), String(plan.startY), String(plan.x), String(plan.endY), '16'],
    req.flags?.out,
    {
      ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
      count: plan.count,
      pauseMs: 0,
      pattern: 'one-way',
    },
  );
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: {
      ...(data ?? {}),
      ref,
      attempts: plan.count,
      direction: plan.direction,
      refLabel,
      selectorChain,
    },
  });
  return {
    ok: true,
    data: {
      ...(data ?? {}),
      ref,
      attempts: plan.count,
      direction: plan.direction,
    },
  };
}
