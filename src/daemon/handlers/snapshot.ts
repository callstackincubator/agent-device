import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { runIosRunnerCommand, stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { snapshotAndroid } from '../../platforms/android/index.ts';
import {
  attachRefs,
  findNodeByRef,
  normalizeRef,
  type RawSnapshotNode,
  type SnapshotState,
} from '../../utils/snapshot.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { findNodeByLabel, pruneGroupNodes, resolveRefLabel } from '../snapshot-processing.ts';
import { buildSnapshotDiff, type SnapshotDiffLine, type SnapshotDiffSummary } from '../snapshot-diff.ts';
import { findSelectorChainMatch, splitSelectorFromArgs, tryParseSelectorChain, type SelectorChain } from '../selectors.ts';
import { parseTimeout, POLL_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from './parse-utils.ts';

export async function handleSnapshotCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore } = params;
  const command = req.command;

  if (command === 'snapshot') {
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    if (!isCommandSupportedOnDevice('snapshot', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'snapshot is not supported on this device',
        },
      };
    }
    const appBundleId = session?.appBundleId;
    const resolvedScope = resolveSnapshotScopeFromRef(req.flags?.snapshotScope, session);
    if (resolvedScope.error) {
      return resolvedScope.error;
    }
    const snapshotScope = resolvedScope.snapshotScope;
    return await withSessionlessRunnerCleanup(session, device, async () => {
      const snapshot = await captureSnapshotState({
        device,
        req,
        logPath,
        session,
        snapshotScope,
      });
      const nextSession: SessionState = session
        ? { ...session, snapshot }
        : { name: sessionName, device, createdAt: Date.now(), appBundleId, snapshot, actions: [] };
      recordIfSession(sessionStore, nextSession, req, {
        nodes: snapshot.nodes.length,
        truncated: snapshot.truncated ?? false,
      });
      sessionStore.set(sessionName, nextSession);
      return {
        ok: true,
        data: {
          nodes: snapshot.nodes,
          truncated: snapshot.truncated ?? false,
          appName: nextSession.appBundleId
            ? (nextSession.appName ?? nextSession.appBundleId)
            : undefined,
          appBundleId: nextSession.appBundleId,
        },
      };
    });
  }

  if (command === 'diff') {
    const kind = req.positionals?.[0]?.toLowerCase();
    if (kind !== 'snapshot') {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'diff currently supports only: snapshot',
        },
      };
    }

    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    if (!isCommandSupportedOnDevice('snapshot', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'snapshot is not supported on this device',
        },
      };
    }
    const appBundleId = session?.appBundleId;
    const resolvedScope = resolveSnapshotScopeFromRef(req.flags?.snapshotScope, session);
    if (resolvedScope.error) {
      return resolvedScope.error;
    }
    const snapshotScope = resolvedScope.snapshotScope;
    return await withSessionlessRunnerCleanup(session, device, async () => {
      const currentSnapshot = await captureSnapshotState({
        device,
        req,
        logPath,
        session,
        snapshotScope,
      });
      const nextSession: SessionState = session
        ? { ...session, snapshot: currentSnapshot }
        : {
          name: sessionName,
          device,
          createdAt: Date.now(),
          appBundleId,
          snapshot: currentSnapshot,
          actions: [],
        };

      const diffData = buildDiffSnapshotResponse(session?.snapshot, currentSnapshot);
      recordIfSession(sessionStore, nextSession, req, {
        mode: 'snapshot',
        baselineInitialized: diffData.baselineInitialized,
        summary: diffData.summary,
      });
      sessionStore.set(sessionName, nextSession);
      return {
        ok: true,
        data: {
          mode: 'snapshot',
          baselineInitialized: diffData.baselineInitialized,
          summary: diffData.summary,
          lines: diffData.lines,
        },
      };
    });
  }

  if (command === 'wait') {
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    const args = req.positionals ?? [];
    const parsed = parseWaitArgs(args);
    if (!parsed) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'wait requires a duration or text' },
      };
    }
    if (parsed.kind === 'sleep') {
      await new Promise((resolve) => setTimeout(resolve, parsed.durationMs));
      recordIfSession(sessionStore, session, req, { waitedMs: parsed.durationMs });
      return { ok: true, data: { waitedMs: parsed.durationMs } };
    }
    if (!isCommandSupportedOnDevice('wait', device)) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'wait is not supported on this device' },
      };
    }
    return await withSessionlessRunnerCleanup(session, device, async () => {
      let text: string;
      let timeoutMs: number | null;
      if (parsed.kind === 'selector') {
        const timeout = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const data = (await dispatchCommand(device, 'snapshot', [], req.flags?.out, {
            ...contextFromFlags(
              logPath,
              {
                ...req.flags,
                snapshotInteractiveOnly: false,
                snapshotCompact: false,
              },
              session?.appBundleId,
              session?.trace?.outPath,
            ),
          })) as {
            nodes?: RawSnapshotNode[];
            truncated?: boolean;
            backend?: 'xctest' | 'android';
          };
          const rawNodes = data?.nodes ?? [];
          const nodes = attachRefs(req.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
          if (session) {
            session.snapshot = {
              nodes,
              truncated: data?.truncated,
              createdAt: Date.now(),
              backend: data?.backend,
            };
            sessionStore.set(sessionName, session);
          }
          const match = findSelectorChainMatch(nodes, parsed.selector, { platform: device.platform });
          if (match) {
            recordIfSession(sessionStore, session, req, {
              selector: match.selector.raw,
              waitedMs: Date.now() - start,
            });
            return {
              ok: true,
              data: {
                selector: match.selector.raw,
                waitedMs: Date.now() - start,
              },
            };
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        return {
          ok: false,
          error: {
            code: 'COMMAND_FAILED',
            message: `wait timed out for selector: ${parsed.selectorExpression}`,
          },
        };
      } else if (parsed.kind === 'ref') {
        if (!session?.snapshot) {
          return {
            ok: false,
            error: {
              code: 'INVALID_ARGS',
              message: 'Ref wait requires an existing snapshot in session.',
            },
          };
        }
        const ref = normalizeRef(parsed.rawRef);
        if (!ref) {
          return {
            ok: false,
            error: { code: 'INVALID_ARGS', message: `Invalid ref: ${parsed.rawRef}` },
          };
        }
        const node = findNodeByRef(session.snapshot.nodes, ref);
        const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
        if (!resolved) {
          return {
            ok: false,
            error: {
              code: 'COMMAND_FAILED',
              message: `Ref ${parsed.rawRef} not found or has no label`,
            },
          };
        }
        text = resolved;
        timeoutMs = parsed.timeoutMs;
      } else {
        text = parsed.text;
        timeoutMs = parsed.timeoutMs;
      }
      if (!text) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'wait requires text' } };
      }
      const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (device.platform === 'ios') {
          const result = (await runIosRunnerCommand(
            device,
            { command: 'findText', text, appBundleId: session?.appBundleId },
            { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
          )) as { found?: boolean };
          if (result?.found) {
            recordIfSession(sessionStore, session, req, { text, waitedMs: Date.now() - start });
            return { ok: true, data: { text, waitedMs: Date.now() - start } };
          }
        } else if (device.platform === 'android') {
          const androidResult = await snapshotAndroid(device, { scope: text });
          if (findNodeByLabel(attachRefs(androidResult.nodes ?? []), text)) {
            recordIfSession(sessionStore, session, req, { text, waitedMs: Date.now() - start });
            return { ok: true, data: { text, waitedMs: Date.now() - start } };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      return {
        ok: false,
        error: { code: 'COMMAND_FAILED', message: `wait timed out for text: ${text}` },
      };
    });
  }

  if (command === 'alert') {
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    const action = (req.positionals?.[0] ?? 'get').toLowerCase();
    if (!isCommandSupportedOnDevice('alert', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'alert is only supported on iOS simulators',
        },
      };
    }
    return await withSessionlessRunnerCleanup(session, device, async () => {
      if (action === 'wait') {
        const timeout = parseTimeout(req.positionals?.[1]) ?? DEFAULT_TIMEOUT_MS;
        const start = Date.now();
        while (Date.now() - start < timeout) {
          try {
            const data = await runIosRunnerCommand(
              device,
              { command: 'alert', action: 'get', appBundleId: session?.appBundleId },
              { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
            );
            recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
            return { ok: true, data };
          } catch {
            // keep waiting
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        return { ok: false, error: { code: 'COMMAND_FAILED', message: 'alert wait timed out' } };
      }
      const data = await runIosRunnerCommand(
        device,
        {
          command: 'alert',
          action:
            action === 'accept' || action === 'dismiss' ? (action as 'accept' | 'dismiss') : 'get',
          appBundleId: session?.appBundleId,
        },
        { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
      );
      recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
      return { ok: true, data };
    });
  }

  if (command === 'settings') {
    const setting = req.positionals?.[0];
    const state = req.positionals?.[1];
    if (!setting || !state) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message:
            'settings requires <wifi|airplane|location> <on|off> or faceid <match|nonmatch|enroll|unenroll>',
        },
      };
    }
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    if (!isCommandSupportedOnDevice('settings', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'settings is not supported on this device',
        },
      };
    }
    return await withSessionlessRunnerCleanup(session, device, async () => {
      const appBundleId = session?.appBundleId;
      const data = await dispatchCommand(
        device,
        'settings',
        [setting, state, appBundleId ?? ''],
        req.flags?.out,
        {
          ...contextFromFlags(logPath, req.flags, appBundleId, session?.trace?.outPath),
        },
      );
      recordIfSession(sessionStore, session, req, data ?? { setting, state });
      return { ok: true, data: data ?? { setting, state } };
    });
  }

  return null;
}

type WaitParsed =
  | { kind: 'sleep'; durationMs: number }
  | { kind: 'ref'; rawRef: string; timeoutMs: number | null }
  | { kind: 'selector'; selector: SelectorChain; selectorExpression: string; timeoutMs: number | null }
  | { kind: 'text'; text: string; timeoutMs: number | null };

export function parseWaitArgs(args: string[]): WaitParsed | null {
  if (args.length === 0) return null;

  const sleepMs = parseTimeout(args[0]);
  if (sleepMs !== null) return { kind: 'sleep', durationMs: sleepMs };

  if (args[0] === 'text') {
    const timeoutMs = parseTimeout(args[args.length - 1]);
    const text = timeoutMs !== null ? args.slice(1, -1).join(' ') : args.slice(1).join(' ');
    return { kind: 'text', text: text.trim(), timeoutMs };
  }

  if (args[0].startsWith('@')) {
    const timeoutMs = parseTimeout(args[args.length - 1]);
    return { kind: 'ref', rawRef: args[0], timeoutMs };
  }

  const timeoutMs = parseTimeout(args[args.length - 1]);
  const argsWithoutTimeout = timeoutMs !== null ? args.slice(0, -1) : args.slice();
  const split = splitSelectorFromArgs(argsWithoutTimeout);
  if (split && split.rest.length === 0) {
    const selector = tryParseSelectorChain(split.selectorExpression);
    if (selector) {
      return {
        kind: 'selector',
        selector,
        selectorExpression: split.selectorExpression,
        timeoutMs,
      };
    }
  }

  const text = timeoutMs !== null ? args.slice(0, -1).join(' ') : args.join(' ');
  return { kind: 'text', text: text.trim(), timeoutMs };
}

async function resolveSessionDevice(
  sessionStore: SessionStore,
  sessionName: string,
  flags: DaemonRequest['flags'],
) {
  const session = sessionStore.get(sessionName);
  const device = session?.device ?? (await resolveTargetDevice(flags ?? {}));
  if (!session) await ensureDeviceReady(device);
  return { session, device };
}

async function withSessionlessRunnerCleanup<T>(
  session: SessionState | undefined,
  device: SessionState['device'],
  task: () => Promise<T>,
): Promise<T> {
  const shouldCleanupSessionlessIosRunner = !session && device.platform === 'ios';
  try {
    return await task();
  } finally {
    // Sessionless iOS commands intentionally stop the runner to avoid leaked xcodebuild processes.
    // For multi-command flows, keep an active session via `open` so the runner can be reused.
    if (shouldCleanupSessionlessIosRunner) {
      await stopIosRunnerSession(device.id);
    }
  }
}

function recordIfSession(
  sessionStore: SessionStore,
  session: SessionState | undefined,
  req: DaemonRequest,
  result: Record<string, unknown>,
): void {
  if (!session) return;
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result,
  });
}

async function captureSnapshotState(params: {
  device: SessionState['device'];
  req: DaemonRequest;
  logPath: string;
  session?: SessionState;
  snapshotScope?: string;
}): Promise<SnapshotState> {
  const { device, req, logPath, session, snapshotScope } = params;
  const data = (await dispatchCommand(device, 'snapshot', [], req.flags?.out, {
    ...contextFromFlags(
      logPath,
      { ...req.flags, snapshotScope },
      session?.appBundleId,
      session?.trace?.outPath,
    ),
  })) as {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android';
  };
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(req.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  return {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
}

function resolveSnapshotScopeFromRef(
  snapshotScope: string | undefined,
  session: SessionState | undefined,
): { snapshotScope: string | undefined; error?: DaemonResponse } {
  if (!snapshotScope || !snapshotScope.trim().startsWith('@')) {
    return { snapshotScope };
  }
  if (!session?.snapshot) {
    return {
      snapshotScope,
      error: {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'Ref scope requires an existing snapshot in session.',
        },
      },
    };
  }
  const ref = normalizeRef(snapshotScope.trim());
  if (!ref) {
    return {
      snapshotScope,
      error: {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `Invalid ref scope: ${snapshotScope}` },
      },
    };
  }
  const node = findNodeByRef(session.snapshot.nodes, ref);
  const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
  if (!resolved) {
    return {
      snapshotScope,
      error: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${snapshotScope} not found or has no label`,
        },
      },
    };
  }
  return { snapshotScope: resolved };
}

export function buildDiffSnapshotResponse(
  previousSnapshot: SnapshotState | undefined,
  currentSnapshot: SnapshotState,
): {
  baselineInitialized: boolean;
  summary: SnapshotDiffSummary;
  lines: SnapshotDiffLine[];
} {
  if (!previousSnapshot) {
    return {
      baselineInitialized: true,
      summary: {
        additions: 0,
        removals: 0,
        unchanged: currentSnapshot.nodes.length,
      },
      lines: [],
    };
  }
  const diff = buildSnapshotDiff(previousSnapshot.nodes, currentSnapshot.nodes);
  return {
    baselineInitialized: false,
    summary: diff.summary,
    lines: diff.lines,
  };
}
