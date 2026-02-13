import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { attachRefs, centerOfRect, findNodeByRef, normalizeRef, type RawSnapshotNode } from '../../utils/snapshot.ts';
import type { DaemonCommandContext } from '../context.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { evaluateIsPredicate, isSupportedPredicate } from '../is-predicates.ts';
import { extractNodeText, findNodeByLabel, isFillableType, pruneGroupNodes, resolveRefLabel } from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  findSelectorChainMatch,
  formatSelectorFailure,
  parseSelectorChain,
  resolveSelectorChain,
  splitSelectorFromArgs,
} from '../selectors.ts';

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
}): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore, contextFromFlags } = params;
  const command = req.command;

  if (command === 'click') {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    const refInput = req.positionals?.[0] ?? '';
    if (refInput.startsWith('@')) {
      if (!session.snapshot) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
      }
      const ref = normalizeRef(refInput);
      if (!ref) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'click requires a ref like @e2' } };
      }
      let node = findNodeByRef(session.snapshot.nodes, ref);
      if (!node?.rect && req.positionals.length > 1) {
        const fallbackLabel = req.positionals.slice(1).join(' ').trim();
        if (fallbackLabel.length > 0) {
          node = findNodeByLabel(session.snapshot.nodes, fallbackLabel);
        }
      }
      if (!node?.rect) {
        return {
          ok: false,
          error: { code: 'COMMAND_FAILED', message: `Ref ${refInput} not found or has no bounds` },
        };
      }
      const refLabel = resolveRefLabel(node, session.snapshot.nodes);
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, { action: 'click' });
      const { x, y } = centerOfRect(node.rect);
      await dispatchCommand(session.device, 'press', [String(x), String(y)], req.flags?.out, {
        ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
      });
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, x, y, refLabel, selectorChain },
      });
      return { ok: true, data: { ref, x, y } };
    }

    const selectorExpression = (req.positionals ?? []).join(' ').trim();
    if (!selectorExpression) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'click requires @ref or selector expression' },
      };
    }
    const chain = parseSelectorChain(selectorExpression);
    const snapshot = await captureSnapshotForSession(session, req.flags, sessionStore, contextFromFlags, {
      interactiveOnly: true,
    });
    const resolved = resolveSelectorChain(snapshot.nodes, chain, {
      platform: session.device.platform,
      requireRect: true,
      requireUnique: true,
      disambiguateAmbiguous: true,
    });
    if (!resolved || !resolved.node.rect) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: formatSelectorFailure(chain, resolved?.diagnostics ?? [], { unique: true }),
        },
      };
    }
    const { x, y } = centerOfRect(resolved.node.rect);
    await dispatchCommand(session.device, 'press', [String(x), String(y)], req.flags?.out, {
      ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
    });
    const selectorChain = buildSelectorChainForNode(resolved.node, session.device.platform, { action: 'click' });
    const refLabel = resolveRefLabel(resolved.node, snapshot.nodes);
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: {
        x,
        y,
        selector: resolved.selector.raw,
        selectorChain,
        refLabel,
      },
    });
    return { ok: true, data: { selector: resolved.selector.raw, x, y } };
  }

  if (command === 'fill') {
    const session = sessionStore.get(sessionName);
    if (req.positionals?.[0]?.startsWith('@')) {
      if (!session?.snapshot) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
      }
      const ref = normalizeRef(req.positionals[0]);
      if (!ref) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'fill requires a ref like @e2' } };
      }
      const labelCandidate = req.positionals.length >= 3 ? req.positionals[1] : '';
      const text = req.positionals.length >= 3 ? req.positionals.slice(2).join(' ') : req.positionals.slice(1).join(' ');
      if (!text) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'fill requires text after ref' } };
      }
      let node = findNodeByRef(session.snapshot.nodes, ref);
      if (!node?.rect && labelCandidate) {
        node = findNodeByLabel(session.snapshot.nodes, labelCandidate);
      }
      if (!node?.rect) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${req.positionals[0]} not found or has no bounds` } };
      }
      const nodeType = node.type ?? '';
      const fillWarning =
        nodeType && !isFillableType(nodeType, session.device.platform)
          ? `fill target ${req.positionals[0]} resolved to "${nodeType}", attempting fill anyway.`
          : undefined;
      const refLabel = resolveRefLabel(node, session.snapshot.nodes);
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, { action: 'fill' });
      const { x, y } = centerOfRect(node.rect);
      const data = await dispatchCommand(
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
        command,
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
    const selectorArgs = splitSelectorFromArgs(req.positionals ?? [], { preferTrailingValue: true });
    if (selectorArgs) {
      if (selectorArgs.rest.length === 0) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'fill requires text after selector' } };
      }
      const text = selectorArgs.rest.join(' ').trim();
      if (!text) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'fill requires text after selector' } };
      }
      const chain = parseSelectorChain(selectorArgs.selectorExpression);
      const snapshot = await captureSnapshotForSession(session, req.flags, sessionStore, contextFromFlags, {
        interactiveOnly: true,
      });
      const resolved = resolveSelectorChain(snapshot.nodes, chain, {
        platform: session.device.platform,
        requireRect: true,
        requireUnique: true,
        disambiguateAmbiguous: true,
      });
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
      const data = await dispatchCommand(session.device, 'fill', [String(x), String(y), text], req.flags?.out, {
        ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
      });
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, { action: 'fill' });
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
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: resultPayload,
      });
      return { ok: true, data: resultPayload };
    }
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: 'fill requires x y text, @ref text, or selector text' },
    };
  }

  if (command === 'get') {
    const sub = req.positionals?.[0];
    if (sub !== 'text' && sub !== 'attrs') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'get only supports text or attrs' } };
    }
    const session = sessionStore.get(sessionName);
    if (!session) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    const refInput = req.positionals?.[1] ?? '';
    if (refInput.startsWith('@')) {
      if (!session.snapshot) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
      }
      const ref = normalizeRef(refInput ?? '');
      if (!ref) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'get text requires a ref like @e2' } };
      }
      let node = findNodeByRef(session.snapshot.nodes, ref);
      if (!node && req.positionals.length > 2) {
        const labelCandidate = req.positionals.slice(2).join(' ').trim();
        if (labelCandidate.length > 0) {
          node = findNodeByLabel(session.snapshot.nodes, labelCandidate);
        }
      }
      if (!node) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${refInput} not found` } };
      }
      const selectorChain = buildSelectorChainForNode(node, session.device.platform, { action: 'get' });
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
    const snapshot = await captureSnapshotForSession(session, req.flags, sessionStore, contextFromFlags, {
      interactiveOnly: false,
    });
    const resolved = resolveSelectorChain(snapshot.nodes, chain, {
      platform: session.device.platform,
      requireRect: false,
      requireUnique: true,
    });
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
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, { action: 'get' });
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
    const selectorArgs = req.positionals.slice(1);
    const split = splitSelectorFromArgs(selectorArgs, { preferTrailingValue: predicate === 'text' });
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
    const snapshot = await captureSnapshotForSession(session, req.flags, sessionStore, contextFromFlags, {
      interactiveOnly: false,
    });
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
      return { ok: true, data: { predicate, pass: true, selector: matched.selector.raw, matches: matched.matches } };
    }

    const resolved = resolveSelectorChain(snapshot.nodes, chain, {
      platform: session.device.platform,
      requireUnique: true,
    });
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

  return null;
}

async function captureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
) {
  const data = (await dispatchCommand(session.device, 'snapshot', [], flags?.out, {
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
    backend?: 'ax' | 'xctest' | 'android';
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
