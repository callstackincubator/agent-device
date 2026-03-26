import { dispatchCommand } from '../../core/dispatch.ts';
import { attachRefs, type RawSnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { extractNodeText, normalizeType, pruneGroupNodes } from '../snapshot-processing.ts';
import {
  buildSelectorChainForNode,
  resolveSelectorChain,
  splitIsSelectorArgs,
  splitSelectorFromArgs,
  tryParseSelectorChain,
} from '../selectors.ts';
import { inferFillText, uniqueStrings } from '../action-utils.ts';
import type { SessionAction, SessionState } from '../types.ts';
import { isClickLikeCommand } from '../script-utils.ts';
import { contextFromFlags } from '../context.ts';
import { SessionStore } from '../session-store.ts';

export function parseSelectorWaitPositionals(positionals: string[]): {
  selectorExpression: string | null;
  selectorTimeout: string | null;
} {
  if (positionals.length === 0) return { selectorExpression: null, selectorTimeout: null };
  const maybeTimeout = positionals[positionals.length - 1];
  const hasTimeout = /^\d+$/.test(maybeTimeout ?? '');
  const selectorTokens = hasTimeout ? positionals.slice(0, -1) : positionals.slice();
  const split = splitSelectorFromArgs(selectorTokens);
  if (!split || split.rest.length > 0) {
    return { selectorExpression: null, selectorTimeout: null };
  }
  return {
    selectorExpression: split.selectorExpression,
    selectorTimeout: hasTimeout ? maybeTimeout : null,
  };
}

export function collectReplaySelectorCandidates(action: SessionAction): string[] {
  const result: string[] = [];
  const explicitChain =
    Array.isArray(action.result?.selectorChain) &&
    action.result?.selectorChain.every((entry) => typeof entry === 'string')
      ? (action.result.selectorChain as string[])
      : [];
  result.push(...explicitChain);

  if (isClickLikeCommand(action.command)) {
    const first = action.positionals?.[0] ?? '';
    if (first && !first.startsWith('@')) {
      result.push(action.positionals.join(' '));
    }
  }
  if (action.command === 'fill') {
    const first = action.positionals?.[0] ?? '';
    if (first && !first.startsWith('@') && Number.isNaN(Number(first))) {
      result.push(first);
    }
  }
  if (action.command === 'get') {
    const selector = action.positionals?.[1] ?? '';
    if (selector && !selector.startsWith('@')) {
      result.push(action.positionals.slice(1).join(' '));
    }
  }
  if (action.command === 'is') {
    const { split } = splitIsSelectorArgs(action.positionals);
    if (split) {
      result.push(split.selectorExpression);
    }
  }
  if (action.command === 'wait') {
    const { selectorExpression } = parseSelectorWaitPositionals(action.positionals ?? []);
    if (selectorExpression) {
      result.push(selectorExpression);
    }
  }

  const refLabel = typeof action.result?.refLabel === 'string' ? action.result.refLabel.trim() : '';
  if (refLabel.length > 0) {
    const quoted = JSON.stringify(refLabel);
    if (action.command === 'fill') {
      result.push(`id=${quoted} editable=true`);
      result.push(`label=${quoted} editable=true`);
      result.push(`text=${quoted} editable=true`);
      result.push(`value=${quoted} editable=true`);
    } else {
      result.push(`id=${quoted}`);
      result.push(`label=${quoted}`);
      result.push(`text=${quoted}`);
      result.push(`value=${quoted}`);
    }
  }

  return uniqueStrings(result).filter((entry) => entry.trim().length > 0);
}

export function healNumericGetTextDrift(
  action: SessionAction,
  snapshot: SnapshotState,
  session: SessionState,
): SessionAction | null {
  if (action.command !== 'get') return null;
  if (action.positionals?.[0] !== 'text') return null;
  const selectorExpression = action.positionals?.[1];
  if (!selectorExpression) return null;
  const chain = tryParseSelectorChain(selectorExpression);
  if (!chain) return null;

  const roleFilters = new Set<string>();
  let hasNumericTerm = false;
  for (const selector of chain.selectors) {
    for (const term of selector.terms) {
      if (term.key === 'role' && typeof term.value === 'string') {
        roleFilters.add(normalizeType(term.value));
      }
      if (
        (term.key === 'text' || term.key === 'label' || term.key === 'value') &&
        typeof term.value === 'string' &&
        /^\d+$/.test(term.value.trim())
      ) {
        hasNumericTerm = true;
      }
    }
  }
  if (!hasNumericTerm) return null;

  const numericNodes = snapshot.nodes.filter((node) => {
    const text = extractNodeText(node).trim();
    if (!/^\d+$/.test(text)) return false;
    if (roleFilters.size === 0) return true;
    return roleFilters.has(normalizeType(node.type ?? ''));
  });
  if (numericNodes.length === 0) return null;
  const numericValues = uniqueStrings(numericNodes.map((node) => extractNodeText(node).trim()));
  if (numericValues.length !== 1) return null;

  const targetNode = numericNodes[0];
  if (!targetNode) return null;
  const selectorChain = buildSelectorChainForNode(targetNode, session.device.platform, {
    action: 'get',
  });
  if (selectorChain.length === 0) return null;
  return {
    ...action,
    positionals: ['text', selectorChain.join(' || ')],
  };
}

export async function healReplayAction(params: {
  action: SessionAction;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatch: typeof dispatchCommand;
}): Promise<SessionAction | null> {
  const { action, sessionName, logPath, sessionStore, dispatch } = params;
  if (
    !(isClickLikeCommand(action.command) || ['fill', 'get', 'is', 'wait'].includes(action.command))
  ) {
    return null;
  }

  const session = sessionStore.get(sessionName);
  if (!session) return null;

  const requiresRect = isClickLikeCommand(action.command) || action.command === 'fill';
  const allowDisambiguation =
    isClickLikeCommand(action.command) ||
    action.command === 'fill' ||
    (action.command === 'get' && action.positionals?.[0] === 'text');
  const snapshot = await captureSnapshotForReplay(
    session,
    action,
    logPath,
    requiresRect,
    dispatch,
    sessionStore,
  );
  const selectorCandidates = collectReplaySelectorCandidates(action);
  for (const candidate of selectorCandidates) {
    const chain = tryParseSelectorChain(candidate);
    if (!chain) continue;
    const resolved = resolveSelectorChain(snapshot.nodes, chain, {
      platform: session.device.platform,
      requireRect: requiresRect,
      requireUnique: true,
      disambiguateAmbiguous: allowDisambiguation,
    });
    if (!resolved) continue;

    const selectorChain = buildSelectorChainForNode(resolved.node, session.device.platform, {
      action: isClickLikeCommand(action.command)
        ? 'click'
        : action.command === 'fill'
          ? 'fill'
          : 'get',
    });
    const selectorExpression = selectorChain.join(' || ');

    if (isClickLikeCommand(action.command)) {
      return { ...action, positionals: [selectorExpression] };
    }
    if (action.command === 'fill') {
      const fillText = inferFillText(action);
      if (!fillText) continue;
      return { ...action, positionals: [selectorExpression, fillText] };
    }
    if (action.command === 'get') {
      const sub = action.positionals?.[0];
      if (sub !== 'text' && sub !== 'attrs') continue;
      return { ...action, positionals: [sub, selectorExpression] };
    }
    if (action.command === 'is') {
      const { predicate, split } = splitIsSelectorArgs(action.positionals);
      if (!predicate) continue;
      const expectedText = split?.rest.join(' ').trim() ?? '';
      const nextPositionals = [predicate, selectorExpression];
      if (predicate === 'text' && expectedText.length > 0) {
        nextPositionals.push(expectedText);
      }
      return { ...action, positionals: nextPositionals };
    }
    if (action.command === 'wait') {
      const { selectorTimeout } = parseSelectorWaitPositionals(action.positionals ?? []);
      const nextPositionals = [selectorExpression];
      if (selectorTimeout) nextPositionals.push(selectorTimeout);
      return { ...action, positionals: nextPositionals };
    }
  }

  return healNumericGetTextDrift(action, snapshot, session);
}

async function captureSnapshotForReplay(
  session: SessionState,
  action: SessionAction,
  logPath: string,
  interactiveOnly: boolean,
  dispatch: typeof dispatchCommand,
  sessionStore: SessionStore,
): Promise<SnapshotState> {
  const data = (await dispatch(session.device, 'snapshot', [], action.flags?.out, {
    ...contextFromFlags(
      logPath,
      {
        ...(action.flags ?? {}),
        snapshotInteractiveOnly: interactiveOnly,
        snapshotCompact: interactiveOnly,
      },
      session.appBundleId,
      session.trace?.outPath,
    ),
  })) as {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android' | 'macos-helper';
  };
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(action.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  const snapshot: SnapshotState = {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
  session.snapshot = snapshot;
  sessionStore.set(session.name, session);
  return snapshot;
}
