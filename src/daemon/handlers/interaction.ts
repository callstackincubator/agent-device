import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import {
  attachRefs,
  centerOfRect,
  findNodeByRef,
  normalizeRef,
  type RawSnapshotNode,
  type Rect,
  type SnapshotNode,
} from '../../utils/snapshot.ts';
import type { DaemonCommandContext } from '../context.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { evaluateIsPredicate, isSupportedPredicate } from '../is-predicates.ts';
import {
  extractNodeText,
  findNodeByLabel,
  pruneGroupNodes,
  resolveRefLabel,
} from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  findSelectorChainMatch,
  formatSelectorFailure,
  parseSelectorChain,
  resolveSelectorChain,
  splitIsSelectorArgs,
} from '../selectors.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import { buildScrollIntoViewPlan, resolveViewportRect } from '../scroll-planner.ts';
import { getAndroidScreenSize } from '../../platforms/android/index.ts';
import { handleTouchInteractionCommands } from './interaction-touch.ts';

type ContextFromFlags = (
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
) => DaemonCommandContext;

export async function handleInteractionCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  dispatch?: typeof dispatchCommand;
  readAndroidScreenSize?: typeof getAndroidScreenSize;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore, contextFromFlags } = params;
  const dispatch = params.dispatch ?? dispatchCommand;
  const readAndroidScreenSize = params.readAndroidScreenSize ?? getAndroidScreenSize;
  const command = req.command;

  const touchResponse = await handleTouchInteractionCommands({
    req,
    sessionName,
    sessionStore,
    contextFromFlags,
    dispatch,
    readAndroidScreenSize,
    captureSnapshotForSession,
    resolveRefTarget,
    refSnapshotFlagGuardResponse,
  });
  if (touchResponse) {
    return touchResponse;
  }

  if (command === 'get') {
    const sub = req.positionals?.[0];
    if (sub !== 'text' && sub !== 'attrs') {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'get only supports text or attrs' },
      };
    }
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    if (!isCommandSupportedOnDevice('get', session.device)) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'get is not supported on this device' },
      };
    }
    const refInput = req.positionals?.[1] ?? '';
    if (refInput.startsWith('@')) {
      const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('get', req.flags);
      if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
      const labelCandidate =
        req.positionals.length > 2 ? req.positionals.slice(2).join(' ').trim() : '';
      const resolvedRefTarget = resolveRefTarget({
        session,
        refInput,
        fallbackLabel: labelCandidate,
        requireRect: false,
        invalidRefMessage: 'get text requires a ref like @e2',
        notFoundMessage: `Ref ${refInput} not found`,
      });
      if (!resolvedRefTarget.ok) return resolvedRefTarget.response;
      const { ref, node } = resolvedRefTarget.target;
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
        action: 'get',
      });
      if (sub === 'attrs') {
        sessionStore.recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, selectorChain },
        });
        return { ok: true, data: { ref, node } };
      }
      const text = extractNodeText(node);
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, text, refLabel: text || undefined, selectorChain },
      });
      return { ok: true, data: { ref, text, node } };
    }

    const selectorExpression = req.positionals.slice(1).join(' ').trim();
    if (!selectorExpression) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'get requires @ref or selector expression' },
      };
    }
    const chain = parseSelectorChain(selectorExpression);
    const snapshot = await captureSnapshotForSession(
      session,
      req.flags,
      sessionStore,
      contextFromFlags,
      { interactiveOnly: false },
      dispatch,
    );
    const resolved = await withDiagnosticTimer(
      'selector_resolve',
      () =>
        resolveSelectorChain(snapshot.nodes, chain, {
          platform: session.device.platform,
          requireRect: false,
          requireUnique: true,
          disambiguateAmbiguous: sub === 'text',
        }),
      { command },
    );
    if (!resolved) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: formatSelectorFailure(chain, [], { unique: true }),
        },
      };
    }
    const node = resolved.node;
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
      action: 'get',
    });
    if (sub === 'attrs') {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { selector: resolved.selector.raw, selectorChain },
      });
      return { ok: true, data: { selector: resolved.selector.raw, node } };
    }
    const text = extractNodeText(node);
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: {
        text,
        refLabel: text || undefined,
        selector: resolved.selector.raw,
        selectorChain,
      },
    });
    return { ok: true, data: { selector: resolved.selector.raw, text, node } };
  }

  if (command === 'is') {
    const predicate = (req.positionals?.[0] ?? '').toLowerCase();
    if (!isSupportedPredicate(predicate)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'is requires predicate: visible|hidden|exists|editable|selected|text',
        },
      };
    }
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    if (!isCommandSupportedOnDevice('is', session.device)) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'is is not supported on this device' },
      };
    }
    const { split } = splitIsSelectorArgs(req.positionals);
    if (!split) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'is requires a selector expression',
        },
      };
    }
    const expectedText = split.rest.join(' ').trim();
    if (predicate === 'text' && !expectedText) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'is text requires expected text value',
        },
      };
    }
    if (predicate !== 'text' && split.rest.length > 0) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: `is ${predicate} does not accept trailing values`,
        },
      };
    }
    const chain = parseSelectorChain(split.selectorExpression);
    const snapshot = await captureSnapshotForSession(
      session,
      req.flags,
      sessionStore,
      contextFromFlags,
      { interactiveOnly: false },
      dispatch,
    );
    if (predicate === 'exists') {
      const matched = findSelectorChainMatch(snapshot.nodes, chain, {
        platform: session.device.platform,
      });
      if (!matched) {
        return {
          ok: false,
          error: {
            code: 'COMMAND_FAILED',
            message: formatSelectorFailure(chain, [], { unique: false }),
          },
        };
      }
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: {
          predicate,
          selector: matched.selector.raw,
          selectorChain: chain.selectors.map((entry) => entry.raw),
          pass: true,
          matches: matched.matches,
        },
      });
      return {
        ok: true,
        data: { predicate, pass: true, selector: matched.selector.raw, matches: matched.matches },
      };
    }

    const resolved = await withDiagnosticTimer(
      'selector_resolve',
      () =>
        resolveSelectorChain(snapshot.nodes, chain, {
          platform: session.device.platform,
          requireUnique: true,
        }),
      { command: 'is', predicate },
    );
    if (!resolved) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: formatSelectorFailure(chain, [], { unique: true }),
        },
      };
    }
    const result = evaluateIsPredicate({
      predicate,
      node: resolved.node,
      expectedText,
      platform: session.device.platform,
    });
    if (!result.pass) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `is ${predicate} failed for selector ${resolved.selector.raw}: ${result.details}`,
        },
      };
    }
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: {
        predicate,
        selector: resolved.selector.raw,
        selectorChain: chain.selectors.map((entry) => entry.raw),
        pass: true,
        text: predicate === 'text' ? result.actualText : undefined,
      },
    });
    return { ok: true, data: { predicate, pass: true, selector: resolved.selector.raw } };
  }

  if (command === 'scrollintoview') {
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
      req.positionals && req.positionals.length > 1
        ? req.positionals.slice(1).join(' ').trim()
        : '';
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
        command,
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
      command,
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

  return null;
}

async function captureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
  dispatch: typeof dispatchCommand = dispatchCommand,
) {
  const data = (await dispatch(session.device, 'snapshot', [], flags?.out, {
    ...contextFromFlags(
      {
        ...(flags ?? {}),
        snapshotInteractiveOnly: options.interactiveOnly,
        snapshotCompact: options.interactiveOnly,
      },
      session.appBundleId,
      session.trace?.outPath,
    ),
  })) as {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android';
  };
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  session.snapshot = {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
  sessionStore.set(session.name, session);
  return session.snapshot;
}

const REF_UNSUPPORTED_FLAG_MAP: ReadonlyArray<[keyof CommandFlags, string]> = [
  ['snapshotDepth', '--depth'],
  ['snapshotScope', '--scope'],
  ['snapshotRaw', '--raw'],
];

function refSnapshotFlagGuardResponse(
  command: 'press' | 'fill' | 'get' | 'scrollintoview',
  flags: CommandFlags | undefined,
): DaemonResponse | null {
  const unsupported = unsupportedRefSnapshotFlags(flags);
  if (unsupported.length === 0) return null;
  return {
    ok: false,
    error: {
      code: 'INVALID_ARGS',
      message: `${command} @ref does not support ${unsupported.join(', ')}.`,
    },
  };
}

export function unsupportedRefSnapshotFlags(flags: CommandFlags | undefined): string[] {
  if (!flags) return [];
  const unsupported: string[] = [];
  for (const [key, label] of REF_UNSUPPORTED_FLAG_MAP) {
    if (flags[key] !== undefined) unsupported.push(label);
  }
  return unsupported;
}

function resolveRefTarget(params: {
  session: SessionState;
  refInput: string;
  fallbackLabel: string;
  requireRect: boolean;
  invalidRefMessage: string;
  notFoundMessage: string;
}):
  | { ok: true; target: { ref: string; node: SnapshotNode; snapshotNodes: SnapshotNode[] } }
  | { ok: false; response: DaemonResponse } {
  const { session, refInput, fallbackLabel, requireRect, invalidRefMessage, notFoundMessage } =
    params;
  if (!session.snapshot) {
    return {
      ok: false,
      response: {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' },
      },
    };
  }
  const ref = normalizeRef(refInput);
  if (!ref) {
    return {
      ok: false,
      response: { ok: false, error: { code: 'INVALID_ARGS', message: invalidRefMessage } },
    };
  }
  let node = findNodeByRef(session.snapshot.nodes, ref);
  if ((!node || (requireRect && !node.rect)) && fallbackLabel.length > 0) {
    node = findNodeByLabel(session.snapshot.nodes, fallbackLabel);
  }
  if (!node || (requireRect && !node.rect)) {
    return {
      ok: false,
      response: { ok: false, error: { code: 'COMMAND_FAILED', message: notFoundMessage } },
    };
  }
  return { ok: true, target: { ref, node, snapshotNodes: session.snapshot.nodes } };
}
