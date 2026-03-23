import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { buildSelectorChainForNode } from '../selectors.ts';
import { findNodeByLabel, resolveRefLabel } from '../snapshot-processing.ts';
import { findNodeByRef } from '../../utils/snapshot.ts';
import type { DaemonResponse } from '../types.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import {
  parseCoordinateTarget,
  resolveRectCenter,
  resolveRefTarget,
} from './interaction-targeting.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { resolveSelectorTarget } from './interaction-selector.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';

export async function handlePressCommand(
  params: InteractionHandlerParams,
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, contextFromFlags, dispatch } = params;
  const commandLabel = req.command === 'click' ? 'click' : 'press';
  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }
  if (!isCommandSupportedOnDevice('press', session.device)) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_OPERATION', message: 'press is not supported on this device' },
    };
  }
  const secondaryClick = req.flags?.secondaryClick === true;
  if (secondaryClick) {
    if (commandLabel !== 'click') {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: '--secondary is supported only for click',
        },
      };
    }
    if (session.device.platform !== 'macos') {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'click --secondary is supported only on macOS',
        },
      };
    }
    if (
      typeof req.flags?.count === 'number' ||
      typeof req.flags?.intervalMs === 'number' ||
      typeof req.flags?.holdMs === 'number' ||
      typeof req.flags?.jitterPx === 'number' ||
      req.flags?.doubleTap === true
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'click --secondary does not support repeat or gesture modifier flags',
        },
      };
    }
  }
  const directCoordinates = parseCoordinateTarget(req.positionals ?? []);
  if (directCoordinates) {
    const data = await dispatch(
      session.device,
      'press',
      [String(directCoordinates.x), String(directCoordinates.y)],
      req.flags?.out,
      {
        ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
      },
    );
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [String(directCoordinates.x), String(directCoordinates.y)],
      flags: req.flags ?? {},
      result: data ?? {
        x: directCoordinates.x,
        y: directCoordinates.y,
        ...(secondaryClick ? { button: 'secondary' } : {}),
      },
    });
    return {
      ok: true,
      data:
        data ??
        ({
          x: directCoordinates.x,
          y: directCoordinates.y,
          ...(secondaryClick ? { button: 'secondary' } : {}),
        } as Record<string, unknown>),
    };
  }

  const refInput = req.positionals?.[0] ?? '';
  if (refInput.startsWith('@')) {
    const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('press', req.flags);
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
    const fallbackLabel =
      req.positionals.length > 1 ? req.positionals.slice(1).join(' ').trim() : '';
    const resolvedRefTarget = resolveRefTarget({
      session,
      refInput,
      fallbackLabel,
      requireRect: true,
      invalidRefMessage: `${commandLabel} requires a ref like @e2`,
      notFoundMessage: `Ref ${refInput} not found or has no bounds`,
    });
    if (!resolvedRefTarget.ok) return resolvedRefTarget.response;
    const { ref } = resolvedRefTarget.target;
    let node = resolvedRefTarget.target.node;
    let snapshotNodes = resolvedRefTarget.target.snapshotNodes;
    let pressPoint = resolveRectCenter(node.rect);
    if (!pressPoint) {
      const refreshed = await captureSnapshotForSession(
        session,
        req.flags,
        sessionStore,
        contextFromFlags,
        { interactiveOnly: true },
        dispatch,
      );
      const refNode = findNodeByRef(refreshed.nodes, ref);
      const fallbackNode =
        fallbackLabel.length > 0 ? findNodeByLabel(refreshed.nodes, fallbackLabel) : null;
      const fallbackNodePoint = resolveRectCenter(fallbackNode?.rect);
      const refNodePoint = resolveRectCenter(refNode?.rect);
      const refreshedNode = refNodePoint
        ? refNode
        : fallbackNodePoint
          ? fallbackNode
          : (refNode ?? fallbackNode);
      const refreshedPoint = resolveRectCenter(refreshedNode?.rect);
      if (refreshedNode && refreshedPoint) {
        node = refreshedNode;
        snapshotNodes = refreshed.nodes;
        pressPoint = refreshedPoint;
      }
    }
    if (!pressPoint) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${refInput} not found or has invalid bounds`,
        },
      };
    }
    const refLabel = resolveRefLabel(node, snapshotNodes);
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
      action: 'click',
    });
    const { x, y } = pressPoint;
    const data = await dispatch(session.device, 'press', [String(x), String(y)], req.flags?.out, {
      ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
    });
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: {
        ref,
        x,
        y,
        refLabel,
        selectorChain,
        ...(secondaryClick ? { button: 'secondary' } : {}),
      },
    });
    return {
      ok: true,
      data: { ...(data ?? {}), ref, x, y, ...(secondaryClick ? { button: 'secondary' } : {}) },
    };
  }

  const selectorExpression = (req.positionals ?? []).join(' ').trim();
  if (!selectorExpression) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `${commandLabel} requires @ref, selector expression, or x y coordinates`,
      },
    };
  }
  const resolvedSelectorTarget = await resolveSelectorTarget({
    command: req.command,
    selectorExpression,
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
  const pressPoint = resolveRectCenter(resolved.node.rect);
  if (!pressPoint) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `Selector ${resolved.selector.raw} resolved to invalid bounds`,
      },
    };
  }
  const { x, y } = pressPoint;
  const data = await dispatch(session.device, 'press', [String(x), String(y)], req.flags?.out, {
    ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
  });
  const selectorChain = buildSelectorChainForNode(resolved.node, session.device.platform, {
    action: 'click',
  });
  const refLabel = resolveRefLabel(resolved.node, snapshot.nodes);
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: {
      x,
      y,
      selector: resolved.selector.raw,
      selectorChain,
      refLabel,
      ...(secondaryClick ? { button: 'secondary' } : {}),
    },
  });
  return {
    ok: true,
    data: {
      ...(data ?? {}),
      selector: resolved.selector.raw,
      x,
      y,
      ...(secondaryClick ? { button: 'secondary' } : {}),
    },
  };
}
