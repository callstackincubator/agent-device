import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { centerOfRect } from '../../utils/snapshot.ts';
import { buildSelectorChainForNode, splitSelectorFromArgs } from '../selectors.ts';
import { isFillableType, resolveRefLabel } from '../snapshot-processing.ts';
import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { resolveRefTarget } from './interaction-targeting.ts';
import { resolveSelectorTarget } from './interaction-selector.ts';

export async function handleFillCommand(params: InteractionHandlerParams): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, contextFromFlags, dispatch } = params;
  const session = sessionStore.get(sessionName);
  if (session && !isCommandSupportedOnDevice('fill', session.device)) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_OPERATION', message: 'fill is not supported on this device' },
    };
  }
  if (req.positionals?.[0]?.startsWith('@')) {
    if (!session) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('fill', req.flags);
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
    const labelCandidate = req.positionals.length >= 3 ? req.positionals[1] : '';
    const text =
      req.positionals.length >= 3
        ? req.positionals.slice(2).join(' ')
        : req.positionals.slice(1).join(' ');
    if (!text) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'fill requires text after ref' },
      };
    }
    const resolvedRefTarget = resolveRefTarget({
      session,
      refInput: req.positionals[0],
      fallbackLabel: labelCandidate,
      requireRect: true,
      invalidRefMessage: 'fill requires a ref like @e2',
      notFoundMessage: `Ref ${req.positionals[0]} not found or has no bounds`,
    });
    if (!resolvedRefTarget.ok) return resolvedRefTarget.response;
    const { ref, node, snapshotNodes } = resolvedRefTarget.target;
    if (!node.rect) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${req.positionals[0]} not found or has no bounds`,
        },
      };
    }
    const nodeType = node.type ?? '';
    const fillWarning =
      nodeType && !isFillableType(nodeType, session.device.platform)
        ? `fill target ${req.positionals[0]} resolved to "${nodeType}", attempting fill anyway.`
        : undefined;
    const refLabel = resolveRefLabel(node, snapshotNodes);
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
      action: 'fill',
    });
    const { x, y } = centerOfRect(node.rect);
    const data = await dispatch(
      session.device,
      'fill',
      [String(x), String(y), text],
      req.flags?.out,
      {
        ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
      },
    );
    const resultPayload: Record<string, unknown> = {
      ...(data ?? { ref, x, y }),
    };
    if (fillWarning) {
      resultPayload.warning = fillWarning;
    }
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ...resultPayload, refLabel, selectorChain },
    });
    return { ok: true, data: resultPayload };
  }
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }
  const selectorArgs = splitSelectorFromArgs(req.positionals ?? [], {
    preferTrailingValue: true,
  });
  if (!selectorArgs) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'fill requires x y text, @ref text, or selector text',
      },
    };
  }
  if (selectorArgs.rest.length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: 'fill requires text after selector' },
    };
  }
  const text = selectorArgs.rest.join(' ').trim();
  if (!text) {
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: 'fill requires text after selector' },
    };
  }
  const resolvedSelectorTarget = await resolveSelectorTarget({
    command: req.command,
    selectorExpression: selectorArgs.selectorExpression,
    session,
    flags: req.flags,
    sessionStore,
    contextFromFlags,
    interactiveOnly: true,
    requireRect: true,
    requireUnique: true,
    disambiguateAmbiguous: true,
    dispatch,
  });
  if (!resolvedSelectorTarget.ok) return resolvedSelectorTarget.response;
  const { resolved, snapshot } = resolvedSelectorTarget;
  const node = resolved.node;
  if (!node.rect) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `Selector ${resolved.selector.raw} resolved to invalid bounds`,
      },
    };
  }
  const nodeType = node.type ?? '';
  const fillWarning =
    nodeType && !isFillableType(nodeType, session.device.platform)
      ? `fill target ${resolved.selector.raw} resolved to "${nodeType}", attempting fill anyway.`
      : undefined;
  const { x, y } = centerOfRect(node.rect);
  const data = await dispatch(
    session.device,
    'fill',
    [String(x), String(y), text],
    req.flags?.out,
    {
      ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
    },
  );
  const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
    action: 'fill',
  });
  const resultPayload: Record<string, unknown> = {
    ...(data ?? { x, y, text }),
    selector: resolved.selector.raw,
    selectorChain,
    refLabel: resolveRefLabel(node, snapshot.nodes),
  };
  if (fillWarning) {
    resultPayload.warning = fillWarning;
  }
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: resultPayload,
  });
  return { ok: true, data: resultPayload };
}
