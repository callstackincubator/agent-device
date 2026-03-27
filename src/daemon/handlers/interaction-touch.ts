import type { CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import {
  buttonTag,
  getClickButtonValidationError,
  resolveClickButton,
} from '../../core/click-button.ts';
import { centerOfRect, findNodeByRef, type Rect, type SnapshotNode } from '../../utils/snapshot.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import {
  findNearestHittableAncestor,
  findNodeByLabel,
  isFillableType,
  resolveRefLabel,
} from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  formatSelectorFailure,
  parseSelectorChain,
  resolveSelectorChain,
  splitSelectorFromArgs,
} from '../selectors.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../../utils/diagnostics.ts';
import { getAndroidScreenSize } from '../../platforms/android/index.ts';
import { getSnapshotReferenceFrame } from '../touch-reference-frame.ts';
import {
  buildTouchVisualizationResult,
  dispatchRecordedTouchInteraction,
  type ContextFromFlags,
} from './interaction-common.ts';

type CaptureSnapshotForSession = (
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
) => Promise<{
  nodes: SnapshotNode[];
  truncated?: boolean;
  createdAt: number;
  backend?: 'xctest' | 'android' | 'macos-helper';
}>;

type ResolveRefTarget =
  | ((params: {
      session: SessionState;
      refInput: string;
      fallbackLabel: string;
      requireRect: boolean;
      invalidRefMessage: string;
      notFoundMessage: string;
    }) =>
      | { ok: true; target: { ref: string; node: SnapshotNode; snapshotNodes: SnapshotNode[] } }
      | { ok: false; response: DaemonResponse })
  | undefined;

type RefSnapshotFlagGuardResponse = (
  command: 'press' | 'fill' | 'get' | 'scrollintoview',
  flags: CommandFlags | undefined,
) => DaemonResponse | null;

export async function handleTouchInteractionCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
  resolveRefTarget: NonNullable<ResolveRefTarget>;
  refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
}): Promise<DaemonResponse | null> {
  const {
    req,
    sessionName,
    sessionStore,
    contextFromFlags,
    captureSnapshotForSession,
    resolveRefTarget,
    refSnapshotFlagGuardResponse,
  } = params;
  const command = req.command;

  if (command === 'press' || command === 'click') {
    const commandLabel = command === 'click' ? 'click' : 'press';
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(
      session,
      commandLabel,
    );
    if (unsupportedSurfaceResponse) {
      return unsupportedSurfaceResponse;
    }
    if (!isCommandSupportedOnDevice('press', session.device)) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'press is not supported on this device' },
      };
    }
    const clickButton = resolveClickButton(req.flags);
    const resultButtonTag = buttonTag(clickButton);
    if (clickButton !== 'primary') {
      const validationError = getClickButtonValidationError({
        commandLabel,
        platform: session.device.platform,
        button: clickButton,
        count: req.flags?.count,
        intervalMs: req.flags?.intervalMs,
        holdMs: req.flags?.holdMs,
        jitterPx: req.flags?.jitterPx,
        doubleTap: req.flags?.doubleTap,
      });
      if (validationError) {
        return {
          ok: false,
          error: {
            code: validationError.code,
            message: validationError.message,
            details: validationError.details,
          },
        };
      }
    }
    const directCoordinates = parseCoordinateTarget(req.positionals ?? []);
    if (directCoordinates) {
      return dispatchRecordedTouchInteraction({
        session,
        sessionStore,
        requestCommand: command,
        requestPositionals: req.positionals ?? [
          String(directCoordinates.x),
          String(directCoordinates.y),
        ],
        flags: req.flags,
        contextFromFlags,
        interactionCommand: 'press',
        interactionPositionals: [String(directCoordinates.x), String(directCoordinates.y)],
        outPath: req.flags?.out,
        buildPayloads: async (data) => {
          const visualizationFrame = await resolveDirectTouchReferenceFrameSafely({
            session,
            flags: req.flags,
            sessionStore,
            contextFromFlags,
            captureSnapshotForSession,
          });
          const result = buildTouchVisualizationResult({
            data,
            fallbackX: directCoordinates.x,
            fallbackY: directCoordinates.y,
            referenceFrame: visualizationFrame,
            extra: resultButtonTag,
          });
          return { result, responseData: result };
        },
      });
    }

    const selectorAction = 'click';
    const refInput = req.positionals?.[0] ?? '';
    if (refInput.startsWith('@')) {
      const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('press', req.flags);
      if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
      const fallbackLabel =
        req.positionals.length > 1 ? req.positionals.slice(1).join(' ').trim() : '';
      const resolvedRefPressTarget = await resolveRefTargetWithRectRefresh({
        session,
        refInput,
        fallbackLabel,
        promoteToHittableAncestor: true,
        invalidRefMessage: `${commandLabel} requires a ref like @e2`,
        missingBoundsMessage: `Ref ${refInput} not found or has no bounds`,
        invalidBoundsMessage: `Ref ${refInput} not found or has invalid bounds`,
        reqFlags: req.flags,
        sessionStore,
        contextFromFlags,
        captureSnapshotForSession,
        resolveRefTarget,
      });
      if (!resolvedRefPressTarget.ok) return resolvedRefPressTarget.response;
      const { ref, node, snapshotNodes, point: pressPoint } = resolvedRefPressTarget.target;
      const refLabel = resolveRefLabel(node, snapshotNodes);
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
        action: selectorAction,
      });
      const { x, y } = pressPoint;
      return dispatchRecordedTouchInteraction({
        session,
        sessionStore,
        requestCommand: command,
        requestPositionals: req.positionals ?? [],
        flags: req.flags,
        contextFromFlags,
        interactionCommand: 'press',
        interactionPositionals: [String(x), String(y)],
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
              ...resultButtonTag,
            },
          });
          return { result, responseData: result };
        },
      });
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
    const chain = parseSelectorChain(selectorExpression);
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
      { command },
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
    const actionableNode = resolveActionableTouchNode(snapshot.nodes, resolved.node);
    const pressPoint = resolveRectCenter(actionableNode.rect);
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
    const selectorChain = buildSelectorChainForNode(actionableNode, session.device.platform, {
      action: selectorAction,
    });
    const refLabel = resolveRefLabel(actionableNode, snapshot.nodes);
    return dispatchRecordedTouchInteraction({
      session,
      sessionStore,
      requestCommand: command,
      requestPositionals: req.positionals ?? [],
      flags: req.flags,
      contextFromFlags,
      interactionCommand: 'press',
      interactionPositionals: [String(x), String(y)],
      outPath: req.flags?.out,
      buildPayloads: (data) => {
        const result = buildTouchVisualizationResult({
          data,
          fallbackX: x,
          fallbackY: y,
          referenceFrame: readSnapshotNodesReferenceFrame(snapshot.nodes),
          extra: {
            selector: resolved.selector.raw,
            selectorChain,
            refLabel,
            ...resultButtonTag,
          },
        });
        return { result, responseData: result };
      },
    });
  }

  if (command === 'fill') {
    const session = sessionStore.get(sessionName);
    if (session) {
      const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(
        session,
        command,
      );
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
        requestCommand: command,
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
        { command },
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
      const nodeType = node.type ?? '';
      const fillWarning =
        nodeType && !isFillableType(nodeType, session.device.platform)
          ? `fill target ${resolved.selector.raw} resolved to "${nodeType}", attempting fill anyway.`
          : undefined;
      const { x, y } = centerOfRect(resolved.node.rect);
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
        action: 'fill',
      });
      return dispatchRecordedTouchInteraction({
        session,
        sessionStore,
        requestCommand: command,
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

  return null;
}

function unsupportedMacOsDesktopSurfaceInteraction(
  session: SessionState,
  command: 'click' | 'press' | 'fill',
): DaemonResponse | null {
  if (session.device.platform !== 'macos') {
    return null;
  }
  if (session.surface !== 'desktop' && session.surface !== 'menubar') {
    return null;
  }
  return {
    ok: false,
    error: {
      code: 'UNSUPPORTED_OPERATION',
      message: `${command} is not supported on macOS ${session.surface} sessions yet. Open an app session to act, or use the ${session.surface} surface to inspect.`,
    },
  };
}

function parseCoordinateTarget(positionals: string[]): { x: number; y: number } | null {
  if (positionals.length < 2) return null;
  const x = Number(positionals[0]);
  const y = Number(positionals[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

async function resolveDirectTouchReferenceFrame(params: {
  session: SessionState;
  flags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
}): Promise<{ referenceWidth: number; referenceHeight: number } | undefined> {
  const { session, flags, sessionStore, contextFromFlags, captureSnapshotForSession } = params;
  if (!session.recording) {
    return undefined;
  }
  if (session.recording.touchReferenceFrame) {
    return session.recording.touchReferenceFrame;
  }

  if (session.device.platform === 'android') {
    const size = await getAndroidScreenSize(session.device);
    const referenceFrame = {
      referenceWidth: size.width,
      referenceHeight: size.height,
    };
    if (session.recording) {
      session.recording.touchReferenceFrame = referenceFrame;
    }
    return referenceFrame;
  }

  const snapshotFrame = getSnapshotReferenceFrame(session.snapshot);
  if (snapshotFrame) {
    if (session.recording) {
      session.recording.touchReferenceFrame = snapshotFrame;
    }
    return snapshotFrame;
  }

  if (!session.recording) {
    return undefined;
  }

  const snapshot = await captureSnapshotForSession(session, flags, sessionStore, contextFromFlags, {
    interactiveOnly: true,
  });
  const referenceFrame = getSnapshotReferenceFrame(snapshot);
  if (referenceFrame && session.recording) {
    session.recording.touchReferenceFrame = referenceFrame;
  }
  return referenceFrame;
}

async function resolveDirectTouchReferenceFrameSafely(params: {
  session: SessionState;
  flags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
}): Promise<{ referenceWidth: number; referenceHeight: number } | undefined> {
  try {
    return await resolveDirectTouchReferenceFrame(params);
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'touch_reference_frame_resolve_failed',
      data: {
        platform: params.session.device.platform,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return undefined;
  }
}

async function resolveRefTargetWithRectRefresh(params: {
  session: SessionState;
  refInput: string;
  fallbackLabel: string;
  promoteToHittableAncestor: boolean;
  invalidRefMessage: string;
  missingBoundsMessage: string;
  invalidBoundsMessage: string;
  reqFlags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
  resolveRefTarget: NonNullable<ResolveRefTarget>;
}): Promise<
  | {
      ok: true;
      target: {
        ref: string;
        node: SnapshotNode;
        snapshotNodes: SnapshotNode[];
        point: { x: number; y: number };
      };
    }
  | { ok: false; response: DaemonResponse }
> {
  const {
    session,
    refInput,
    fallbackLabel,
    promoteToHittableAncestor,
    invalidRefMessage,
    missingBoundsMessage,
    invalidBoundsMessage,
    reqFlags,
    sessionStore,
    contextFromFlags,
    captureSnapshotForSession,
    resolveRefTarget,
  } = params;
  const resolvedRefTarget = resolveRefTarget({
    session,
    refInput,
    fallbackLabel,
    requireRect: true,
    invalidRefMessage,
    notFoundMessage: missingBoundsMessage,
  });
  if (!resolvedRefTarget.ok) return { ok: false, response: resolvedRefTarget.response };

  const { ref } = resolvedRefTarget.target;
  let node = promoteToHittableAncestor
    ? resolveActionableTouchNode(
        resolvedRefTarget.target.snapshotNodes,
        resolvedRefTarget.target.node,
      )
    : resolvedRefTarget.target.node;
  let snapshotNodes = resolvedRefTarget.target.snapshotNodes;
  let point = resolveRectCenter(node.rect);

  if (!point) {
    const refreshed = await captureSnapshotForSession(
      session,
      reqFlags,
      sessionStore,
      contextFromFlags,
      { interactiveOnly: true },
    );
    const refNode = findNodeByRef(refreshed.nodes, ref);
    const fallbackNode =
      fallbackLabel.length > 0 ? findNodeByLabel(refreshed.nodes, fallbackLabel) : null;
    const resolvedRefNode =
      refNode && promoteToHittableAncestor
        ? resolveActionableTouchNode(refreshed.nodes, refNode)
        : refNode;
    const resolvedFallbackNode =
      fallbackNode && promoteToHittableAncestor
        ? resolveActionableTouchNode(refreshed.nodes, fallbackNode)
        : fallbackNode;
    const fallbackNodePoint = resolveRectCenter(resolvedFallbackNode?.rect);
    const refNodePoint = resolveRectCenter(resolvedRefNode?.rect);
    const refreshedNode = refNodePoint
      ? resolvedRefNode
      : fallbackNodePoint
        ? resolvedFallbackNode
        : (resolvedRefNode ?? resolvedFallbackNode);
    const refreshedPoint = resolveRectCenter(refreshedNode?.rect);
    if (refreshedNode && refreshedPoint) {
      node = refreshedNode;
      snapshotNodes = refreshed.nodes;
      point = refreshedPoint;
    }
  }

  if (!point) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: invalidBoundsMessage,
        },
      },
    };
  }

  return { ok: true, target: { ref, node, snapshotNodes, point } };
}

function resolveActionableTouchNode(nodes: SnapshotNode[], node: SnapshotNode): SnapshotNode {
  const ancestor = findNearestHittableAncestor(nodes, node);
  if (ancestor?.rect && resolveRectCenter(ancestor.rect)) {
    return ancestor;
  }
  return node;
}

function readSnapshotNodesReferenceFrame(
  nodes: SnapshotNode[],
): { referenceWidth: number; referenceHeight: number } | undefined {
  return getSnapshotReferenceFrame({
    nodes,
    createdAt: 0,
  });
}

function resolveRectCenter(rect: Rect | undefined): { x: number; y: number } | null {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;
  const center = centerOfRect(normalized);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  return center;
}

function normalizeRect(rect: Rect | undefined): Rect | null {
  if (!rect) return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}
