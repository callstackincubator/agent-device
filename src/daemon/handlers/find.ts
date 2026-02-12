import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { findBestMatchesByLocator, type FindLocator } from '../../utils/finders.ts';
import { attachRefs, centerOfRect, type RawSnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { AppError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import {
  extractNodeText,
  findNearestHittableAncestor,
  pruneGroupNodes,
} from '../snapshot-processing.ts';
import { parseTimeout } from './parse-utils.ts';

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
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'find requires a locator or text' } };
  }
  const { locator, query, action, value, timeoutMs } = parseFindArgs(args);
  if (!query) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'find requires a value' } };
  }
  const session = sessionStore.get(sessionName);
  const isReadOnly = action === 'exists' || action === 'wait' || action === 'get_text' || action === 'get_attrs';
  if (!session && !isReadOnly) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }
  const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
  if (!session) {
    await ensureDeviceReady(device);
  }
  const appBundleId = session?.appBundleId;
  const scope = shouldScopeFind(locator) ? query : undefined;
  const requiresRect = action === 'click' || action === 'focus' || action === 'fill' || action === 'type';
  const interactiveOnly = requiresRect;
  let lastSnapshotAt = 0;
  let lastNodes: SnapshotState['nodes'] | null = null;
  const fetchNodes = async (): Promise<{
    nodes: SnapshotState['nodes'];
    truncated?: boolean;
    backend?: SnapshotState['backend'];
  }> => {
    const now = Date.now();
    if (lastNodes && now - lastSnapshotAt < 750) {
      return { nodes: lastNodes };
    }
    const data = (await dispatchCommand(device, 'snapshot', [], req.flags?.out, {
      ...contextFromFlags(
        logPath,
        {
          ...req.flags,
          snapshotScope: scope,
          snapshotInteractiveOnly: interactiveOnly,
          snapshotCompact: interactiveOnly,
        },
        appBundleId,
        session?.trace?.outPath,
      ),
    })) as {
      nodes?: RawSnapshotNode[];
      truncated?: boolean;
      backend?: 'ax' | 'xctest' | 'android';
    };
    const rawNodes = data?.nodes ?? [];
    const nodes = attachRefs(req.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
    lastSnapshotAt = now;
    lastNodes = nodes;
    if (session) {
      const snapshot: SnapshotState = {
        nodes,
        truncated: data?.truncated,
        createdAt: Date.now(),
        backend: data?.backend,
      };
      session.snapshot = snapshot;
      sessionStore.set(sessionName, session);
    }
    return { nodes, truncated: data?.truncated, backend: data?.backend };
  };
  if (action === 'wait') {
    const timeout = timeoutMs ?? 10000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const { nodes } = await fetchNodes();
      const match = findBestMatchesByLocator(nodes, locator, query, { requireRect: false }).matches[0];
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
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'find wait timed out' } };
  }
  const { nodes } = await fetchNodes();
  const bestMatches = findBestMatchesByLocator(nodes, locator, query, { requireRect: requiresRect });
  if (requiresRect && bestMatches.matches.length > 1) {
    const candidates = bestMatches.matches.slice(0, 8).map((candidate) => {
      const label = extractNodeText(candidate) || candidate.label || candidate.identifier || candidate.type || '';
      return `@${candidate.ref}${label ? `(${label})` : ''}`;
    });
    return {
      ok: false,
      error: {
        code: 'AMBIGUOUS_MATCH',
        message: `find matched ${bestMatches.matches.length} elements for ${locator} "${query}". Use a more specific locator or selector.`,
        details: {
          locator,
          query,
          matches: bestMatches.matches.length,
          candidates,
        },
      },
    };
  }
  const node = bestMatches.matches[0] ?? null;
  if (!node) {
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'find did not match any element' } };
  }
  const resolvedNode =
    action === 'click' || action === 'focus' || action === 'fill' || action === 'type'
      ? findNearestHittableAncestor(nodes, node) ?? node
      : node;
  const ref = `@${resolvedNode.ref}`;
  const actionFlags = { ...(req.flags ?? {}), noRecord: true };
  if (action === 'exists') {
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
  if (action === 'get_text') {
    const text = extractNodeText(node);
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, action: 'get text', text },
      });
    }
    return { ok: true, data: { ref, text, node } };
  }
  if (action === 'get_attrs') {
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, action: 'get attrs' },
      });
    }
    return { ok: true, data: { ref, node } };
  }
  if (action === 'click') {
    const response = await invoke({
      token: req.token,
      session: sessionName,
      command: 'click',
      positionals: [ref],
      flags: actionFlags,
    });
    if (!response.ok) return response;
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, action: 'click' },
      });
    }
    return response;
  }
  if (action === 'fill') {
    if (!value) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'find fill requires text' } };
    }
    const response = await invoke({
      token: req.token,
      session: sessionName,
      command: 'fill',
      positionals: [ref, value],
      flags: actionFlags,
    });
    if (!response.ok) return response;
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, action: 'fill' },
      });
    }
    return response;
  }
  if (action === 'focus') {
    const coords = node.rect ? centerOfRect(node.rect) : null;
    if (!coords) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'matched element has no bounds' } };
    }
    const response = await dispatchCommand(device, 'focus', [String(coords.x), String(coords.y)], req.flags?.out, {
      ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
    });
    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, action: 'focus' },
      });
    }
    return { ok: true, data: response ?? { ref } };
  }
  if (action === 'type') {
    if (!value) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'find type requires text' } };
    }
    const coords = node.rect ? centerOfRect(node.rect) : null;
    if (!coords) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'matched element has no bounds' } };
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
        result: { ref, action: 'type' },
      });
    }
    return { ok: true, data: response ?? { ref } };
  }

  return null;
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
