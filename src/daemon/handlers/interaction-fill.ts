import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { centerOfRect } from '../../utils/snapshot.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import {
  buildSelectorChainForNode,
  formatSelectorFailure,
  parseSelectorChain,
  resolveSelectorChain,
  splitSelectorFromArgs,
} from '../selectors.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import type { SessionStore } from '../session-store.ts';
import { isFillableType, resolveRefLabel } from '../snapshot-processing.ts';
import {
  buildTouchVisualizationResult,
  dispatchRecordedTouchInteraction,
  type ContextFromFlags,
} from './interaction-common.ts';
import { type CaptureSnapshotForSession } from './interaction-snapshot.ts';
import { readSnapshotNodesReferenceFrame } from './interaction-touch-reference-frame.ts';
import { resolveRefTargetWithRectRefresh, type ResolveRefTarget } from './interaction-targeting.ts';
import { unsupportedMacOsDesktopSurfaceInteraction } from './interaction-touch-policy.ts';
import type { RefSnapshotFlagGuardResponse } from './interaction-flags.ts';

export async function handleFillCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
  resolveRefTarget: ResolveRefTarget;
  refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    sessionStore,
    contextFromFlags,
    captureSnapshotForSession,
    resolveRefTarget,
    refSnapshotFlagGuardResponse,
  } = params;
  const session = sessionStore.get(sessionName);

  if (session) {
    const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(session, 'fill');
    if (unsupportedSurfaceResponse) {
      return unsupportedSurfaceResponse;
    }
  }
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

    const resolvedRefFillTarget = await resolveRefTargetWithRectRefresh({
      session,
      refInput: req.positionals[0],
      fallbackLabel: labelCandidate,
      promoteToHittableAncestor: false,
      invalidRefMessage: 'fill requires a ref like @e2',
      missingBoundsMessage: `Ref ${req.positionals[0]} not found or has no bounds`,
      invalidBoundsMessage: `Ref ${req.positionals[0]} not found or has invalid bounds`,
      reqFlags: req.flags,
      sessionStore,
      contextFromFlags,
      captureSnapshotForSession,
      resolveRefTarget,
    });
    if (!resolvedRefFillTarget.ok) return resolvedRefFillTarget.response;

    const { ref, node, snapshotNodes, point } = resolvedRefFillTarget.target;
    const nodeType = node.type ?? '';
    const fillWarning =
      nodeType && !isFillableType(nodeType, session.device.platform)
        ? `fill target ${req.positionals[0]} resolved to "${nodeType}", attempting fill anyway.`
        : undefined;
    const refLabel = resolveRefLabel(node, snapshotNodes);
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
      action: 'fill',
    });
    const { x, y } = point;
    return dispatchRecordedTouchInteraction({
      session,
      sessionStore,
      requestCommand: req.command,
      requestPositionals: req.positionals ?? [],
      flags: req.flags,
      contextFromFlags,
      interactionCommand: 'fill',
      interactionPositionals: [String(x), String(y), text],
      outPath: req.flags?.out,
      buildPayloads: (data) => {
        const result = buildTouchVisualizationResult({
          data,
          fallbackX: x,
          fallbackY: y,
          referenceFrame: readSnapshotNodesReferenceFrame(snapshotNodes),
          extra: {
            ref,
            refLabel,
            selectorChain,
            text,
          },
        });
        const responseData: Record<string, unknown> = {
          ...(data ?? { ref, x, y }),
        };
        if (fillWarning) {
          result.warning = fillWarning;
          responseData.warning = fillWarning;
        }
        return { result, responseData };
      },
    });
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
  if (selectorArgs) {
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

    const chain = parseSelectorChain(selectorArgs.selectorExpression);
    const snapshot = await captureSnapshotForSession(
      session,
      req.flags,
      sessionStore,
      contextFromFlags,
      { interactiveOnly: true },
    );
    const resolved = await withDiagnosticTimer(
      'selector_resolve',
      () =>
        resolveSelectorChain(snapshot.nodes, chain, {
          platform: session.device.platform,
          requireRect: true,
          requireUnique: true,
          disambiguateAmbiguous: true,
        }),
      { command: req.command },
    );
    if (!resolved || !resolved.node.rect) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: formatSelectorFailure(chain, resolved?.diagnostics ?? [], { unique: true }),
        },
      };
    }

    const node = resolved.node;
    const rect = resolved.node.rect;
    const nodeType = node.type ?? '';
    const fillWarning =
      nodeType && !isFillableType(nodeType, session.device.platform)
        ? `fill target ${resolved.selector.raw} resolved to "${nodeType}", attempting fill anyway.`
        : undefined;
    const { x, y } = centerOfRect(rect);
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
      action: 'fill',
    });
    return dispatchRecordedTouchInteraction({
      session,
      sessionStore,
      requestCommand: req.command,
      requestPositionals: req.positionals ?? [],
      flags: req.flags,
      contextFromFlags,
      interactionCommand: 'fill',
      interactionPositionals: [String(x), String(y), text],
      outPath: req.flags?.out,
      buildPayloads: (data) => {
        const result = buildTouchVisualizationResult({
          data,
          fallbackX: x,
          fallbackY: y,
          referenceFrame: readSnapshotNodesReferenceFrame(snapshot.nodes),
          extra: {
            text,
            selector: resolved.selector.raw,
            selectorChain,
            refLabel: resolveRefLabel(node, snapshot.nodes),
          },
        });
        if (fillWarning) {
          result.warning = fillWarning;
        }
        return { result, responseData: result };
      },
    });
  }

  return {
    ok: false,
    error: {
      code: 'INVALID_ARGS',
      message: 'fill requires x y text, @ref text, or selector text',
    },
  };
}
