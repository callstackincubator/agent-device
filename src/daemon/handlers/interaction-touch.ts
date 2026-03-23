import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { centerOfRect, findNodeByRef, type Rect, type SnapshotNode } from '../../utils/snapshot.ts';
import type { DaemonCommandContext } from '../context.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { findNodeByLabel, isFillableType, resolveRefLabel } from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  formatSelectorFailure,
  parseSelectorChain,
  resolveSelectorChain,
  splitSelectorFromArgs,
} from '../selectors.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import { recordTouchVisualizationEvent } from '../recording-gestures.ts';
import { getAndroidScreenSize } from '../../platforms/android/index.ts';
import { getSnapshotReferenceFrame } from '../touch-reference-frame.ts';

type ContextFromFlags = (
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
) => DaemonCommandContext;

type CaptureSnapshotForSession = (
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
  dispatch?: typeof dispatchCommand,
) => Promise<{
  nodes: SnapshotNode[];
  truncated?: boolean;
  createdAt: number;
  backend?: 'xctest' | 'android';
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
  dispatch?: typeof dispatchCommand;
  readAndroidScreenSize?: typeof getAndroidScreenSize;
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
  const dispatch = params.dispatch ?? dispatchCommand;
  const readAndroidScreenSize = params.readAndroidScreenSize ?? getAndroidScreenSize;
  const command = req.command;

  if (command === 'press') {
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
    const directCoordinates = parseCoordinateTarget(req.positionals ?? []);
    if (directCoordinates) {
      const interaction = await dispatchInteractionCommand({
        session,
        flags: req.flags,
        contextFromFlags,
        dispatch,
        command: 'press',
        positionals: [String(directCoordinates.x), String(directCoordinates.y)],
        outPath: req.flags?.out,
      });
      const visualizationFrame = await resolveDirectTouchReferenceFrame({
        session,
        flags: req.flags,
        sessionStore,
        contextFromFlags,
        captureSnapshotForSession,
        dispatch,
        readAndroidScreenSize,
      });
      const visualizationResult = {
        ...(interaction.data ?? { x: directCoordinates.x, y: directCoordinates.y }),
        ...(visualizationFrame ?? {}),
      };
      return finalizeTouchInteraction({
        session,
        sessionStore,
        command,
        positionals: req.positionals ?? [String(directCoordinates.x), String(directCoordinates.y)],
        flags: req.flags,
        result: visualizationResult,
        responseData: visualizationResult,
        actionStartedAt: interaction.actionStartedAt,
        actionFinishedAt: interaction.actionFinishedAt,
      });
    }

    const selectorAction = 'click';
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
        invalidRefMessage: `${command} requires a ref like @e2`,
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
        action: selectorAction,
      });
      const { x, y } = pressPoint;
      const interaction = await dispatchInteractionCommand({
        session,
        flags: req.flags,
        contextFromFlags,
        dispatch,
        command: 'press',
        positionals: [String(x), String(y)],
        outPath: req.flags?.out,
      });
      const resultPayload = buildTouchVisualizationResult({
        data: interaction.data,
        fallbackX: x,
        fallbackY: y,
        referenceFrame: readSnapshotNodesReferenceFrame(snapshotNodes),
        extra: {
          ref,
          refLabel,
          selectorChain,
        },
      });
      return finalizeTouchInteraction({
        session,
        sessionStore,
        command,
        positionals: req.positionals ?? [],
        flags: req.flags,
        result: resultPayload,
        responseData: resultPayload,
        actionStartedAt: interaction.actionStartedAt,
        actionFinishedAt: interaction.actionFinishedAt,
      });
    }

    const selectorExpression = (req.positionals ?? []).join(' ').trim();
    if (!selectorExpression) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: `${command} requires @ref, selector expression, or x y coordinates`,
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
      dispatch,
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
    const interaction = await dispatchInteractionCommand({
      session,
      flags: req.flags,
      contextFromFlags,
      dispatch,
      command: 'press',
      positionals: [String(x), String(y)],
      outPath: req.flags?.out,
    });
    const selectorChain = buildSelectorChainForNode(resolved.node, session.device.platform, {
      action: selectorAction,
    });
    const refLabel = resolveRefLabel(resolved.node, snapshot.nodes);
    const resultPayload = buildTouchVisualizationResult({
      data: interaction.data,
      fallbackX: x,
      fallbackY: y,
      referenceFrame: readSnapshotNodesReferenceFrame(snapshot.nodes),
      extra: {
        selector: resolved.selector.raw,
        selectorChain,
        refLabel,
      },
    });
    return finalizeTouchInteraction({
      session,
      sessionStore,
      command,
      positionals: req.positionals ?? [],
      flags: req.flags,
      result: resultPayload,
      responseData: resultPayload,
      actionStartedAt: interaction.actionStartedAt,
      actionFinishedAt: interaction.actionFinishedAt,
    });
  }

  if (command === 'fill') {
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
      const interaction = await dispatchInteractionCommand({
        session,
        flags: req.flags,
        contextFromFlags,
        dispatch,
        command: 'fill',
        positionals: [String(x), String(y), text],
        outPath: req.flags?.out,
      });
      const resultPayload: Record<string, unknown> = {
        ...(interaction.data ?? { ref, x, y }),
      };
      if (fillWarning) {
        resultPayload.warning = fillWarning;
      }
      return finalizeTouchInteraction({
        session,
        sessionStore,
        command,
        positionals: req.positionals ?? [],
        flags: req.flags,
        result: {
          ...resultPayload,
          refLabel,
          selectorChain,
        },
        responseData: resultPayload,
        actionStartedAt: interaction.actionStartedAt,
        actionFinishedAt: interaction.actionFinishedAt,
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
        dispatch,
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
      const interaction = await dispatchInteractionCommand({
        session,
        flags: req.flags,
        contextFromFlags,
        dispatch,
        command: 'fill',
        positionals: [String(x), String(y), text],
        outPath: req.flags?.out,
      });
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
        action: 'fill',
      });
      const resultPayload = buildTouchVisualizationResult({
        data: interaction.data,
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
        resultPayload.warning = fillWarning;
      }
      return finalizeTouchInteraction({
        session,
        sessionStore,
        command,
        positionals: req.positionals ?? [],
        flags: req.flags,
        result: resultPayload,
        responseData: resultPayload,
        actionStartedAt: interaction.actionStartedAt,
        actionFinishedAt: interaction.actionFinishedAt,
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
  dispatch: typeof dispatchCommand;
  readAndroidScreenSize: typeof getAndroidScreenSize;
}): Promise<{ referenceWidth: number; referenceHeight: number } | undefined> {
  const {
    session,
    flags,
    sessionStore,
    contextFromFlags,
    captureSnapshotForSession,
    dispatch,
    readAndroidScreenSize,
  } = params;
  if (session.recording?.touchReferenceFrame) {
    return session.recording.touchReferenceFrame;
  }

  if (session.device.platform === 'android') {
    const size = await readAndroidScreenSize(session.device);
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

  const snapshot = await captureSnapshotForSession(
    session,
    flags,
    sessionStore,
    contextFromFlags,
    { interactiveOnly: true },
    dispatch,
  );
  const referenceFrame = getSnapshotReferenceFrame(snapshot);
  if (referenceFrame && session.recording) {
    session.recording.touchReferenceFrame = referenceFrame;
  }
  return referenceFrame;
}

function readSnapshotNodesReferenceFrame(
  nodes: SnapshotNode[],
): { referenceWidth: number; referenceHeight: number } | undefined {
  return getSnapshotReferenceFrame({
    nodes,
    createdAt: 0,
  });
}

function buildTouchVisualizationResult(params: {
  data: Record<string, unknown> | undefined;
  fallbackX: number;
  fallbackY: number;
  referenceFrame?: { referenceWidth: number; referenceHeight: number };
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const { data, fallbackX, fallbackY, referenceFrame, extra } = params;
  return {
    x: fallbackX,
    y: fallbackY,
    ...(referenceFrame ?? {}),
    ...(extra ?? {}),
    ...(data ?? {}),
  };
}

async function dispatchInteractionCommand(params: {
  session: SessionState;
  flags: CommandFlags | undefined;
  contextFromFlags: ContextFromFlags;
  dispatch: typeof dispatchCommand;
  command: string;
  positionals: string[];
  outPath: string | undefined;
}): Promise<{
  data: Record<string, unknown> | undefined;
  actionStartedAt: number;
  actionFinishedAt: number;
}> {
  const { session, flags, contextFromFlags, dispatch, command, positionals, outPath } = params;
  const actionStartedAt = Date.now();
  const dispatchContext = {
    ...contextFromFlags(flags, session.appBundleId, session.trace?.outPath),
  };
  const rawData = await dispatch(session.device, command, positionals, outPath, dispatchContext);
  const actionFinishedAt = Date.now();
  const data = rawData && typeof rawData === 'object' ? rawData : undefined;
  return { data, actionStartedAt, actionFinishedAt };
}

function finalizeTouchInteraction(params: {
  session: SessionState;
  sessionStore: SessionStore;
  command: string;
  positionals: string[];
  flags: CommandFlags | undefined;
  result: Record<string, unknown>;
  responseData: Record<string, unknown>;
  actionStartedAt: number;
  actionFinishedAt: number;
}): DaemonResponse {
  const {
    session,
    sessionStore,
    command,
    positionals,
    flags,
    result,
    responseData,
    actionStartedAt,
    actionFinishedAt,
  } = params;
  sessionStore.recordAction(session, {
    command,
    positionals,
    flags: flags ?? {},
    result,
  });
  recordTouchVisualizationEvent(
    session,
    command,
    positionals,
    result,
    (flags ?? {}) as Record<string, unknown>,
    actionStartedAt,
    actionFinishedAt,
  );
  return { ok: true, data: responseData };
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
