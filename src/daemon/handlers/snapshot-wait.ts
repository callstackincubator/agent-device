import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { dispatchCommand } from '../../core/dispatch.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import { snapshotAndroid } from '../../platforms/android/index.ts';
import { attachRefs, findNodeByRef, normalizeRef, type RawSnapshotNode } from '../../utils/snapshot.ts';
import { contextFromFlags } from '../context.ts';
import { findNodeByLabel, resolveRefLabel } from '../snapshot-processing.ts';
import { SessionStore } from '../session-store.ts';
import {
  findSelectorChainMatch,
  splitSelectorFromArgs,
  tryParseSelectorChain,
  type SelectorChain,
} from '../selectors.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { buildSnapshotState } from './snapshot-capture.ts';
import { recordIfSession } from './snapshot-session.ts';
import { DEFAULT_TIMEOUT_MS, parseTimeout, POLL_INTERVAL_MS } from './parse-utils.ts';

export type WaitParsed =
  | { kind: 'sleep'; durationMs: number }
  | { kind: 'ref'; rawRef: string; timeoutMs: number | null }
  | {
      kind: 'selector';
      selector: SelectorChain;
      selectorExpression: string;
      timeoutMs: number | null;
    }
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

type HandleWaitCommandParams = {
  parsed: WaitParsed;
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  session: SessionState | undefined;
  device: SessionState['device'];
  dispatchSnapshotCommand?: typeof dispatchCommand;
};

export function waitNeedsRunnerCleanup(parsed: WaitParsed): boolean {
  return parsed.kind !== 'sleep';
}

export async function handleWaitCommand(params: HandleWaitCommandParams): Promise<DaemonResponse> {
  const { parsed, req, sessionName, logPath, sessionStore, session, device } = params;
  const dispatchSnapshotCommand = params.dispatchSnapshotCommand ?? dispatchCommand;
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

  if (parsed.kind === 'selector') {
    return await waitForSelector({
      dispatchSnapshotCommand,
      device,
      logPath,
      parsed,
      req,
      session,
      sessionName,
      sessionStore,
    });
  }

  const textResult = resolveWaitText(parsed, session);
  if (!textResult.ok) return textResult.response;
  return await waitForText({
    device,
    logPath,
    req,
    session,
    sessionStore,
    text: textResult.text,
    timeoutMs: textResult.timeoutMs,
  });
}

async function waitForSelector(params: {
  dispatchSnapshotCommand: typeof dispatchCommand;
  device: SessionState['device'];
  logPath: string;
  parsed: Extract<WaitParsed, { kind: 'selector' }>;
  req: DaemonRequest;
  session: SessionState | undefined;
  sessionName: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { dispatchSnapshotCommand, device, logPath, parsed, req, session, sessionName, sessionStore } =
    params;
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
    }));
    const snapshot = buildSnapshotState(
      data as {
        nodes?: RawSnapshotNode[];
        truncated?: boolean;
        backend?: 'xctest' | 'android';
      },
      req.flags?.snapshotRaw,
    );
    const nodes = snapshot.nodes;
    if (session) {
      session.snapshot = snapshot;
      sessionStore.set(sessionName, session);
    }
    const match = findSelectorChainMatch(nodes, parsed.selector, {
      platform: device.platform,
    });
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
}

function resolveWaitText(
  parsed: Exclude<WaitParsed, { kind: 'sleep' } | { kind: 'selector' }>,
  session: SessionState | undefined,
): { ok: true; text: string; timeoutMs: number | null } | { ok: false; response: DaemonResponse } {
  if (parsed.kind === 'ref') {
    if (!session?.snapshot) {
      return {
        ok: false,
        response: {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'Ref wait requires an existing snapshot in session.',
          },
        },
      };
    }
    const ref = normalizeRef(parsed.rawRef);
    if (!ref) {
      return {
        ok: false,
        response: {
          ok: false,
          error: { code: 'INVALID_ARGS', message: `Invalid ref: ${parsed.rawRef}` },
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
            message: `Ref ${parsed.rawRef} not found or has no label`,
          },
        },
      };
    }
    return { ok: true, text: resolved, timeoutMs: parsed.timeoutMs };
  }

  if (!parsed.text) {
    return {
      ok: false,
      response: { ok: false, error: { code: 'INVALID_ARGS', message: 'wait requires text' } },
    };
  }
  return { ok: true, text: parsed.text, timeoutMs: parsed.timeoutMs };
}

async function waitForText(params: {
  device: SessionState['device'];
  logPath: string;
  req: DaemonRequest;
  session: SessionState | undefined;
  sessionStore: SessionStore;
  text: string;
  timeoutMs: number | null;
}): Promise<DaemonResponse> {
  const { device, logPath, req, session, sessionStore, text, timeoutMs } = params;
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (device.platform === 'ios') {
      const result = (await runIosRunnerCommand(
        device,
        { command: 'findText', text, appBundleId: session?.appBundleId },
        {
          verbose: req.flags?.verbose,
          logPath,
          traceLogPath: session?.trace?.outPath,
          requestId: req.meta?.requestId,
        },
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
}
