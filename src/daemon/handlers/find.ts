import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { findBestMatchesByLocator, type FindLocator } from '../../utils/finders.ts';
import { centerOfRect, type SnapshotState } from '../../utils/snapshot.ts';
import { AppError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { extractNodeText, findNearestHittableAncestor } from '../snapshot-processing.ts';
import { parseTimeout } from './parse-utils.ts';
import { readTextForNode } from './interaction-read.ts';
import { captureSnapshot } from './snapshot-capture.ts';
import { errorResponse, sessionNotFoundResponse } from './response.ts';
import { getActiveAndroidSnapshotFreshness } from '../android-snapshot-freshness.ts';

type FindContext = {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  session: ReturnType<SessionStore['get']>;
  device: NonNullable<ReturnType<SessionStore['get']>>['device'];
  command: string;
  locator: FindLocator;
  query: string;
};

type ResolvedMatch = {
  node: SnapshotState['nodes'][number];
  resolvedNode: SnapshotState['nodes'][number];
  ref: string;
  nodes: SnapshotState['nodes'];
  actionFlags: Record<string, unknown>;
};

export async function handleFindCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore, invoke } = params;
  const command = req.command;
  if (command !== 'find') return null;

  const args = req.positionals ?? [];
  if (args.length === 0) {
    return errorResponse('INVALID_ARGS', 'find requires a locator or text');
  }
  const { locator, query, action, value, timeoutMs } = parseFindArgs(args);
  if (!query) {
    return errorResponse('INVALID_ARGS', 'find requires a value');
  }
  if (req.flags?.findFirst && req.flags?.findLast) {
    return errorResponse('INVALID_ARGS', 'find accepts only one of --first or --last');
  }
  const session = sessionStore.get(sessionName);
  const isReadOnly =
    action === 'exists' || action === 'wait' || action === 'get_text' || action === 'get_attrs';
  if (!session && !isReadOnly) {
    return sessionNotFoundResponse();
  }
  const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
  if (!session) {
    await ensureDeviceReady(device);
  }
  const scope = shouldScopeFind(locator) ? query : undefined;
  const requiresRect =
    action === 'click' || action === 'focus' || action === 'fill' || action === 'type';
  const interactiveOnly = requiresRect;
  let lastSnapshotAt = 0;
  let lastNodes: SnapshotState['nodes'] | null = null;
  const fetchNodes = async (): Promise<{
    nodes: SnapshotState['nodes'];
    truncated?: boolean;
    backend?: SnapshotState['backend'];
  }> => {
    const now = Date.now();
    // Re-use a snapshot captured within the last 750 ms to avoid redundant dumps during
    // rapid find iterations.  Skipped when Android freshness tracking is active, because
    // the cached tree may already be stale from a recent navigation action.
    if (lastNodes && now - lastSnapshotAt < 750 && !getActiveAndroidSnapshotFreshness(session)) {
      return { nodes: lastNodes };
    }
    const { snapshot } = await captureSnapshot({
      device,
      session,
      flags: {
        ...req.flags,
        snapshotInteractiveOnly: interactiveOnly,
        snapshotCompact: interactiveOnly,
      },
      outPath: req.flags?.out,
      logPath,
      snapshotScope: scope,
    });
    const nodes = snapshot.nodes;
    lastSnapshotAt = now;
    lastNodes = nodes;
    if (session) {
      session.snapshot = snapshot;
      sessionStore.set(sessionName, session);
    }
    return { nodes, truncated: snapshot.truncated, backend: snapshot.backend };
  };

  const ctx: FindContext = {
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
    session,
    device,
    command,
    locator,
    query,
  };

  if (action === 'wait') {
    return handleFindWait(ctx, fetchNodes, locator, query, timeoutMs);
  }

  const { nodes } = await fetchNodes();
  const bestMatches = findBestMatchesByLocator(nodes, locator, query, {
    requireRect: requiresRect,
  });

  if (requiresRect && bestMatches.matches.length > 1) {
    if (req.flags?.findFirst) {
      bestMatches.matches = [bestMatches.matches[0]];
    } else if (req.flags?.findLast) {
      bestMatches.matches = [bestMatches.matches[bestMatches.matches.length - 1]];
    } else {
      return buildAmbiguousMatchError(bestMatches.matches, locator, query);
    }
  }

  const node = bestMatches.matches[0] ?? null;
  if (!node) {
    return errorResponse('COMMAND_FAILED', 'find did not match any element');
  }

  const resolvedNode =
    action === 'click' || action === 'focus' || action === 'fill' || action === 'type'
      ? (findNearestHittableAncestor(nodes, node) ?? node)
      : node;
  const ref = `@${resolvedNode.ref}`;
  const actionFlags = { ...(req.flags ?? {}), noRecord: true };
  const match: ResolvedMatch = { node, resolvedNode, ref, nodes, actionFlags };

  const actionHandlers: Record<string, () => Promise<DaemonResponse | null>> = {
    exists: () => handleFindExists(ctx),
    get_text: () => handleFindGetText(ctx, match),
    get_attrs: () => handleFindGetAttrs(ctx, match),
    click: () => handleFindClick(ctx, match),
    fill: () => handleFindFill(ctx, match, value),
    focus: () => handleFindFocus(ctx, match),
    type: () => handleFindType(ctx, match, value),
  };

  const handler = actionHandlers[action];
  return handler ? handler() : null;
}

// --- Per-action handlers ---

async function handleFindWait(
  ctx: FindContext,
  fetchNodes: () => Promise<{ nodes: SnapshotState['nodes'] }>,
  locator: FindLocator,
  query: string,
  timeoutMs: number | undefined,
): Promise<DaemonResponse> {
  const { req, sessionStore, session, command } = ctx;
  const timeout = timeoutMs ?? 10000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { nodes } = await fetchNodes();
    const match = findBestMatchesByLocator(nodes, locator, query, { requireRect: false })
      .matches[0];
    if (match) {
      if (session) {
        sessionStore.recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { found: true, waitedMs: Date.now() - start },
        });
      }
      return { ok: true, data: { found: true, waitedMs: Date.now() - start } };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return errorResponse('COMMAND_FAILED', 'find wait timed out');
}

async function handleFindExists(ctx: FindContext): Promise<DaemonResponse> {
  const { req, sessionStore, session, command } = ctx;
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { found: true },
    });
  }
  return { ok: true, data: { found: true } };
}

async function handleFindGetText(ctx: FindContext, match: ResolvedMatch): Promise<DaemonResponse> {
  const { req, sessionStore, session, command, device, logPath } = ctx;
  const text = await readTextForNode({
    device,
    node: match.node,
    flags: req.flags,
    appBundleId: session?.appBundleId,
    traceOutPath: session?.trace?.outPath,
    surface: session?.surface,
    contextFromFlags: (flags, appBundleId, traceLogPath) =>
      contextFromFlags(logPath, flags, appBundleId, traceLogPath),
  });
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref: match.ref, action: 'get text', text },
    });
  }
  return { ok: true, data: { ref: match.ref, text, node: match.node } };
}

async function handleFindGetAttrs(ctx: FindContext, match: ResolvedMatch): Promise<DaemonResponse> {
  const { req, sessionStore, session, command } = ctx;
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref: match.ref, action: 'get attrs' },
    });
  }
  return { ok: true, data: { ref: match.ref, node: match.node } };
}

async function handleFindClick(ctx: FindContext, match: ResolvedMatch): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, session, invoke, command, locator, query } = ctx;
  const response = await invoke({
    token: req.token,
    session: sessionName,
    command: 'click',
    positionals: [match.ref],
    flags: match.actionFlags,
  });
  if (!response.ok) return response;
  const matchCoords = match.resolvedNode.rect ? centerOfRect(match.resolvedNode.rect) : null;
  const matchData: Record<string, unknown> = { ref: match.ref, locator, query };
  if (matchCoords) {
    matchData.x = matchCoords.x;
    matchData.y = matchCoords.y;
  }
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref: match.ref, action: 'click', locator, query },
    });
  }
  return { ok: true, data: matchData };
}

async function handleFindFill(
  ctx: FindContext,
  match: ResolvedMatch,
  value: string | undefined,
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, session, invoke, command } = ctx;
  if (!value) {
    return errorResponse('INVALID_ARGS', 'find fill requires text');
  }
  const response = await invoke({
    token: req.token,
    session: sessionName,
    command: 'fill',
    positionals: [match.ref, value],
    flags: match.actionFlags,
  });
  if (!response.ok) return response;
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref: match.ref, action: 'fill' },
    });
  }
  return response;
}

async function handleFindFocus(ctx: FindContext, match: ResolvedMatch): Promise<DaemonResponse> {
  const { req, sessionStore, session, device, command, logPath } = ctx;
  const coords = match.node.rect ? centerOfRect(match.node.rect) : null;
  if (!coords) {
    return errorResponse('COMMAND_FAILED', 'matched element has no bounds');
  }
  const response = await dispatchCommand(
    device,
    'focus',
    [String(coords.x), String(coords.y)],
    req.flags?.out,
    {
      ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
    },
  );
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref: match.ref, action: 'focus' },
    });
  }
  return { ok: true, data: response ?? { ref: match.ref } };
}

async function handleFindType(
  ctx: FindContext,
  match: ResolvedMatch,
  value: string | undefined,
): Promise<DaemonResponse> {
  const { req, sessionStore, session, device, command, logPath } = ctx;
  if (!value) {
    return errorResponse('INVALID_ARGS', 'find type requires text');
  }
  const coords = match.node.rect ? centerOfRect(match.node.rect) : null;
  if (!coords) {
    return errorResponse('COMMAND_FAILED', 'matched element has no bounds');
  }
  await dispatchCommand(device, 'focus', [String(coords.x), String(coords.y)], req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  });
  const response = await dispatchCommand(device, 'type', [value], req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  });
  if (session) {
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref: match.ref, action: 'type' },
    });
  }
  return { ok: true, data: response ?? { ref: match.ref } };
}

// --- Helpers ---

function buildAmbiguousMatchError(
  matches: SnapshotState['nodes'],
  locator: FindLocator,
  query: string,
): DaemonResponse {
  const candidates = matches.slice(0, 8).map((candidate) => {
    const label =
      extractNodeText(candidate) || candidate.label || candidate.identifier || candidate.type || '';
    return `@${candidate.ref}${label ? `(${label})` : ''}`;
  });
  return errorResponse(
    'AMBIGUOUS_MATCH',
    `find matched ${matches.length} elements for ${locator} "${query}". Use a more specific locator or selector.`,
    {
      locator,
      query,
      matches: matches.length,
      candidates,
    },
  );
}

type FindAction =
  | { kind: 'click' }
  | { kind: 'focus' }
  | { kind: 'fill'; value: string }
  | { kind: 'type'; value: string }
  | { kind: 'get_text' }
  | { kind: 'get_attrs' }
  | { kind: 'exists' }
  | { kind: 'wait'; timeoutMs?: number };

export function parseFindArgs(args: string[]): {
  locator: FindLocator;
  query: string;
  action: FindAction['kind'];
  value?: string;
  timeoutMs?: number;
} {
  const locatorTokens: FindLocator[] = ['text', 'label', 'value', 'role', 'id'];
  let locator: FindLocator = 'any';
  let queryIndex = 0;
  if (locatorTokens.includes(args[0] as FindLocator)) {
    locator = args[0] as FindLocator;
    queryIndex = 1;
  }
  const query = args[queryIndex] ?? '';
  const actionTokens = args.slice(queryIndex + 1);
  if (actionTokens.length === 0) {
    return { locator, query, action: 'click' };
  }
  const action = actionTokens[0].toLowerCase();
  if (action === 'get') {
    const sub = actionTokens[1]?.toLowerCase();
    if (sub === 'text') return { locator, query, action: 'get_text' };
    if (sub === 'attrs') return { locator, query, action: 'get_attrs' };
    throw new AppError('INVALID_ARGS', 'find get only supports text or attrs');
  }
  if (action === 'wait') {
    const timeoutMs = parseTimeout(actionTokens[1]);
    return { locator, query, action: 'wait', timeoutMs: timeoutMs ?? undefined };
  }
  if (action === 'exists') return { locator, query, action: 'exists' };
  if (action === 'click') return { locator, query, action: 'click' };
  if (action === 'focus') return { locator, query, action: 'focus' };
  if (action === 'fill') {
    const value = actionTokens.slice(1).join(' ');
    return { locator, query, action: 'fill', value };
  }
  if (action === 'type') {
    const value = actionTokens.slice(1).join(' ');
    return { locator, query, action: 'type', value };
  }
  throw new AppError('INVALID_ARGS', `Unsupported find action: ${actionTokens[0]}`);
}

function shouldScopeFind(locator: FindLocator): boolean {
  return locator !== 'role';
}
