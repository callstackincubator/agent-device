import { dispatchCommand } from '../../core/dispatch.ts';
import { attachRefs, type RawSnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { pruneGroupNodes } from '../snapshot-processing.ts';
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

  return uniqueStrings(result).filter((entry) => entry.trim().length > 0);
}

function collectReplaySelectorChains(action: SessionAction) {
  return collectReplaySelectorCandidates(action)
    .map((candidate) => tryParseSelectorChain(candidate))
    .filter((chain) => chain !== null);
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
  const selectorChains = collectReplaySelectorChains(action);
  if (selectorChains.length === 0) return null;

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
  for (const chain of selectorChains) {
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
  return null;
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
