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
import { findSelectorChainMatch, splitSelectorFromArgs, tryParseSelectorChain, type SelectorChain } from '../selectors.ts';
import { parseTimeout, POLL_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from './parse-utils.ts';
import { buildSnapshotDiff, countSnapshotComparableLines } from '../snapshot-diff.ts';

export async function handleSnapshotCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatchSnapshotCommand?: typeof dispatchCommand;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore } = params;
  const dispatchSnapshotCommand = params.dispatchSnapshotCommand ?? dispatchCommand;
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
    const resolvedScope = resolveSnapshotScope(req.flags?.snapshotScope, session);
    if (!resolvedScope.ok) return resolvedScope.response;

    return await withSessionlessRunnerCleanup(session, device, async () => {
      const appBundleId = session?.appBundleId;
      const capture = await captureSnapshot({
        dispatchSnapshotCommand,
        device,
        session,
        req,
        logPath,
        snapshotScope: resolvedScope.scope,
      });
      const nextSession: SessionState = session
        ? { ...session, snapshot: capture.snapshot }
        : {
          name: sessionName,
          device,
          createdAt: Date.now(),
          appBundleId,
          snapshot: capture.snapshot,
          actions: [],
        };
      recordIfSession(sessionStore, nextSession, req, {
        nodes: capture.snapshot.nodes.length,
        truncated: capture.snapshot.truncated ?? false,
      });
      sessionStore.set(sessionName, nextSession);
      return {
        ok: true,
        data: {
          nodes: capture.snapshot.nodes,
          truncated: capture.snapshot.truncated ?? false,
          appName: nextSession.appBundleId
            ? (nextSession.appName ?? nextSession.appBundleId)
            : undefined,
          appBundleId: nextSession.appBundleId,
        },
      };
    });
  }

  if (command === 'diff') {
    if (req.positionals?.[0] !== 'snapshot') {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'diff currently supports only: diff snapshot',
        },
      };
    }
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    if (!isCommandSupportedOnDevice('diff', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'diff is not supported on this device',
        },
      };
    }
    const resolvedScope = resolveSnapshotScope(req.flags?.snapshotScope, session);
    if (!resolvedScope.ok) return resolvedScope.response;

    return await withSessionlessRunnerCleanup(session, device, async () => {
      const appBundleId = session?.appBundleId;
      const capture = await captureSnapshot({
        dispatchSnapshotCommand,
        device,
        session,
        req,
        logPath,
        snapshotScope: resolvedScope.scope,
      });
      const currentSnapshot = capture.snapshot;

      if (!session?.snapshot) {
        const unchanged = countSnapshotComparableLines(currentSnapshot.nodes);
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
        recordIfSession(sessionStore, nextSession, req, {
          mode: 'snapshot',
          baselineInitialized: true,
          summary: {
            additions: 0,
            removals: 0,
            unchanged,
          },
        });
        sessionStore.set(sessionName, nextSession);
        return {
          ok: true,
          data: {
            mode: 'snapshot',
            baselineInitialized: true,
            summary: {
              additions: 0,
              removals: 0,
              unchanged,
            },
            lines: [],
          },
        };
      }

      const diff = buildSnapshotDiff(session.snapshot.nodes, currentSnapshot.nodes);
      const nextSession: SessionState = { ...session, snapshot: currentSnapshot };
      recordIfSession(sessionStore, nextSession, req, {
        mode: 'snapshot',
        baselineInitialized: false,
        summary: diff.summary,
      });
      sessionStore.set(sessionName, nextSession);
      return {
        ok: true,
        data: {
          mode: 'snapshot',
          baselineInitialized: false,
          summary: diff.summary,
          lines: diff.lines,
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
          const data = (await dispatchSnapshotCommand(device, 'snapshot', [], req.flags?.out, {
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

type CaptureSnapshotParams = {
  dispatchSnapshotCommand: typeof dispatchCommand;
  device: SessionState['device'];
  session: SessionState | undefined;
  req: DaemonRequest;
  logPath: string;
  snapshotScope?: string;
};

async function captureSnapshot(params: CaptureSnapshotParams): Promise<{ snapshot: SnapshotState }> {
  const { dispatchSnapshotCommand, device, session, req, logPath, snapshotScope } = params;
  const data = (await dispatchSnapshotCommand(device, 'snapshot', [], req.flags?.out, {
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
    snapshot: {
      nodes,
      truncated: data?.truncated,
      createdAt: Date.now(),
      backend: data?.backend,
    },
  };
}

function resolveSnapshotScope(
  snapshotScope: string | undefined,
  session: SessionState | undefined,
): { ok: true; scope?: string } | { ok: false; response: DaemonResponse } {
  if (!snapshotScope || !snapshotScope.trim().startsWith('@')) {
    return { ok: true, scope: snapshotScope };
  }
  if (!session?.snapshot) {
    return {
      ok: false,
      response: {
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
      ok: false,
      response: {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `Invalid ref scope: ${snapshotScope}` },
      },
    };
  }
  const node = findNodeByRef(session.snapshot.nodes, ref);
  const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
  if (!resolved) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${snapshotScope} not found or has no label`,
        },
      },
    };
  }
  return { ok: true, scope: resolved };
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
