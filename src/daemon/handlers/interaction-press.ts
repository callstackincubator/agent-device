import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import {
  buttonTag,
  getClickButtonValidationError,
  resolveClickButton,
} from '../../core/click-button.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import {
  buildSelectorChainForNode,
  formatSelectorFailure,
  parseSelectorChain,
  resolveSelectorChain,
} from '../selectors.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import {
  buildTouchVisualizationResult,
  dispatchRecordedTouchInteraction,
  type ContextFromFlags,
} from './interaction-common.ts';
import type { SessionStore } from '../session-store.ts';
import {
  parseCoordinateTarget,
  resolveActionableTouchNode,
  resolveRectCenter,
  resolveRefTargetWithRectRefresh,
  type ResolveRefTarget,
} from './interaction-targeting.ts';
import { type CaptureSnapshotForSession } from './interaction-snapshot.ts';
import {
  readSnapshotNodesReferenceFrame,
  resolveDirectTouchReferenceFrameSafely,
} from './interaction-touch-reference-frame.ts';
import { unsupportedMacOsDesktopSurfaceInteraction } from './interaction-touch-policy.ts';
import type { RefSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { resolveRefLabel } from '../snapshot-processing.ts';
import { errorResponse, sessionNotFoundResponse, unsupportedOperationResponse } from './response.ts';
import { AppError } from '../../utils/errors.ts';
import { getAndroidAppState } from '../../platforms/android/index.ts';

export async function handlePressCommand(params: {
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
  const command = req.command;
  const commandLabel = command === 'click' ? 'click' : 'press';
  if (!session) {
    return sessionNotFoundResponse();
  }

  const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(
    session,
    commandLabel,
  );
  if (unsupportedSurfaceResponse) {
    return unsupportedSurfaceResponse;
  }
  if (!isCommandSupportedOnDevice('press', session.device)) {
    return unsupportedOperationResponse('press');
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
      return errorResponse(validationError.code, validationError.message, validationError.details);
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
      afterDispatch: async () => {
        await assertAndroidPressStayedInApp(session, 'coordinate tap');
      },
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
      commandLabel,
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
      afterDispatch: async () => {
        await assertAndroidPressStayedInApp(session, `@${ref}`);
      },
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
    return errorResponse(
      'INVALID_ARGS',
      `${commandLabel} requires @ref, selector expression, or x y coordinates`,
    );
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
    return errorResponse(
      'COMMAND_FAILED',
      formatSelectorFailure(chain, resolved?.diagnostics ?? [], { unique: true }),
    );
  }

  const actionableNode = resolveActionableTouchNode(snapshot.nodes, resolved.node);
  const pressPoint = resolveRectCenter(actionableNode.rect);
  if (!pressPoint) {
    return errorResponse(
      'COMMAND_FAILED',
      `Selector ${resolved.selector.raw} resolved to invalid bounds`,
    );
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
    afterDispatch: async () => {
      await assertAndroidPressStayedInApp(session, resolved.selector.raw);
    },
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

async function assertAndroidPressStayedInApp(
  session: Parameters<typeof dispatchRecordedTouchInteraction>[0]['session'],
  targetLabel: string,
): Promise<void> {
  if (session.device.platform !== 'android' || !session.appBundleId) {
    return;
  }

  const foreground = await getAndroidAppState(session.device);
  const foregroundPackage = foreground.package?.trim();
  if (!foregroundPackage || foregroundPackage === session.appBundleId) {
    return;
  }
  if (!looksLikeAndroidEscapeSurface(foregroundPackage)) {
    return;
  }

  throw new AppError(
    'COMMAND_FAILED',
    `press ${targetLabel} left ${session.appBundleId} and foregrounded ${foregroundPackage}. The tap likely escaped the app.`,
    {
      expectedPackage: session.appBundleId,
      foregroundPackage,
      activity: foreground.activity,
      hint: 'Use screenshot as visual truth, then take a fresh snapshot -i before retrying.',
    },
  );
}

function looksLikeAndroidEscapeSurface(packageName: string): boolean {
  return (
    packageName === 'com.android.settings' ||
    packageName === 'com.android.systemui' ||
    packageName === 'com.google.android.permissioncontroller' ||
    packageName.includes('launcher')
  );
}
