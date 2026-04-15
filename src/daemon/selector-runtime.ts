import type {
  AgentDeviceBackend,
  BackendSnapshotOptions,
  BackendSnapshotResult,
} from '../backend.ts';
import { createAgentDevice, localCommandPolicy } from '../runtime.ts';
import { isCommandSupportedOnDevice } from '../core/capabilities.ts';
import { resolveTargetDevice, type CommandFlags } from '../core/dispatch.ts';
import { isApplePlatform } from '../utils/device.ts';
import { AppError, asAppError } from '../utils/errors.ts';
import type { SnapshotNode } from '../utils/snapshot.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from './types.ts';
import { SessionStore } from './session-store.ts';
import { contextFromFlags } from './context.ts';
import { ensureDeviceReady } from './device-ready.ts';
import { captureSnapshot } from './handlers/snapshot-capture.ts';
import { readTextForNode } from './handlers/interaction-read.ts';
import {
  parseWaitArgs,
  waitNeedsRunnerCleanup,
  type WaitParsed,
} from './handlers/snapshot-wait.ts';
import { errorResponse } from './handlers/response.ts';
import { findNodeByLabel } from './snapshot-processing.ts';
import { resolveSessionDevice, withSessionlessRunnerCleanup } from './handlers/snapshot-session.ts';
import { parseFindArgs, type FindAction } from '../utils/finders.ts';
import { splitIsSelectorArgs } from './selectors.ts';
import { refSnapshotFlagGuardResponse } from './handlers/interaction-flags.ts';
import type { IsCommandOptions } from '../commands/selector-read.ts';
import { isSupportedPredicate } from './is-predicates.ts';
import type { ContextFromFlags } from './handlers/interaction-common.ts';
import {
  buildFindRecordResult,
  buildGetRecordResult,
  recordIfSession,
  stripSelectorChain,
  toDaemonFindData,
  toDaemonGetData,
  toDaemonWaitData,
} from './selector-recording.ts';

type SelectorRuntimeParams = {
  req: DaemonRequest;
  sessionName: string;
  logPath?: string;
  sessionStore: SessionStore;
  contextFromFlags?: ContextFromFlags;
};

type SnapshotFlagOverrides = Partial<
  Pick<
    CommandFlags,
    | 'snapshotInteractiveOnly'
    | 'snapshotCompact'
    | 'snapshotScope'
    | 'snapshotDepth'
    | 'snapshotRaw'
  >
>;

export async function dispatchFindReadOnlyViaRuntime(
  params: SelectorRuntimeParams,
): Promise<DaemonResponse | null> {
  const { req } = params;
  if (req.command !== 'find') return null;
  const args = req.positionals ?? [];
  if (args.length === 0) return errorResponse('INVALID_ARGS', 'find requires a locator or text');
  const parsed = parseFindArgs(args);
  if (!parsed.query) return errorResponse('INVALID_ARGS', 'find requires a value');
  if (req.flags?.findFirst && req.flags?.findLast) {
    return errorResponse('INVALID_ARGS', 'find accepts only one of --first or --last');
  }
  const action = parsed.action;
  if (!isReadOnlyFindAction(action)) return null;

  const resolvedRuntime = await createSelectorRuntime(params, {
    requireSession: false,
    capability: 'find',
  });
  if (!resolvedRuntime.ok) return resolvedRuntime.response;

  return await toDaemonResponse(async () => {
    const result = await resolvedRuntime.runtime.selectors.find({
      session: params.sessionName,
      requestId: req.meta?.requestId,
      locator: parsed.locator,
      query: parsed.query,
      action,
      timeoutMs: parsed.timeoutMs,
    });
    recordIfSession(
      params.sessionStore,
      params.sessionName,
      req,
      buildFindRecordResult(result, action),
    );
    return toDaemonFindData(result);
  });
}

export async function dispatchGetViaRuntime(
  params: SelectorRuntimeParams,
): Promise<DaemonResponse | null> {
  const { req } = params;
  if (req.command !== 'get') return null;
  const sub = req.positionals?.[0];
  if (sub !== 'text' && sub !== 'attrs') {
    return errorResponse('INVALID_ARGS', 'get only supports text or attrs');
  }
  const resolvedRuntime = await createSelectorRuntime(params, {
    requireSession: true,
    capability: 'get',
  });
  if (!resolvedRuntime.ok) return resolvedRuntime.response;

  const target = parseGetTarget(req);
  if (!target.ok) return target.response;
  if (target.target.kind === 'ref') {
    const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('get', req.flags);
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
  }

  return await toDaemonResponse(async () => {
    const result = await resolvedRuntime.runtime.selectors.get({
      session: params.sessionName,
      requestId: req.meta?.requestId,
      property: sub,
      target: target.target,
    });
    recordIfSession(
      params.sessionStore,
      params.sessionName,
      req,
      buildGetRecordResult(result, sub),
    );
    return toDaemonGetData(result);
  });
}

export async function dispatchIsViaRuntime(
  params: SelectorRuntimeParams,
): Promise<DaemonResponse | null> {
  const { req } = params;
  if (req.command !== 'is') return null;
  const predicate = (req.positionals?.[0] ?? '').toLowerCase();
  if (!isSupportedPredicate(predicate)) {
    return errorResponse(
      'INVALID_ARGS',
      'is requires predicate: visible|hidden|exists|editable|selected|text',
    );
  }
  const { split } = splitIsSelectorArgs(req.positionals ?? []);
  if (!split) return errorResponse('INVALID_ARGS', 'is requires a selector expression');
  const expectedText = split.rest.join(' ').trim();
  if (predicate === 'text' && !expectedText) {
    return errorResponse('INVALID_ARGS', 'is text requires expected text value');
  }
  if (predicate !== 'text' && split.rest.length > 0) {
    return errorResponse('INVALID_ARGS', `is ${predicate} does not accept trailing values`);
  }
  const resolvedRuntime = await createSelectorRuntime(params, {
    requireSession: true,
    capability: 'is',
  });
  if (!resolvedRuntime.ok) return resolvedRuntime.response;

  return await toDaemonResponse(async () => {
    const result = await resolvedRuntime.runtime.selectors.is({
      session: params.sessionName,
      requestId: req.meta?.requestId,
      predicate: predicate as IsCommandOptions['predicate'],
      selector: split.selectorExpression,
      expectedText,
    });
    recordIfSession(params.sessionStore, params.sessionName, req, result);
    return stripSelectorChain(result);
  });
}

export async function dispatchWaitViaRuntime(
  params: SelectorRuntimeParams,
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const parsed = parseWaitArgs(req.positionals ?? []);
  if (!parsed) return errorResponse('INVALID_ARGS', 'wait requires a duration or text');
  const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
  if (parsed.kind !== 'sleep' && !isCommandSupportedOnDevice('wait', device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'wait is not supported on this device');
  }
  const execute = async () => {
    const runtime = createSelectorRuntimeForDevice({
      ...params,
      session,
      device,
    });
    return await toDaemonResponse(async () => {
      const result = await runtime.selectors.wait({
        session: sessionName,
        requestId: req.meta?.requestId,
        target: toWaitTarget(parsed, session),
      });
      recordIfSession(sessionStore, sessionName, req, result);
      return toDaemonWaitData(result);
    });
  };
  if (!waitNeedsRunnerCleanup(parsed)) return await execute();
  return await withSessionlessRunnerCleanup(session, device, execute);
}

function createSelectorRuntimeForDevice(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath?: string;
  sessionStore: SessionStore;
  contextFromFlags?: ContextFromFlags;
  session: SessionState | undefined;
  device: SessionState['device'];
}) {
  return createAgentDevice({
    backend: createSelectorBackend(params),
    artifacts: {
      resolveInput: async () => {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'selector commands do not resolve input artifacts',
        );
      },
      reserveOutput: async () => {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'selector commands do not reserve output artifacts',
        );
      },
      createTempFile: async () => {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'selector commands do not create temporary files',
        );
      },
    },
    sessions: {
      get: (name) => (name === params.sessionName ? toCommandSession(params.session) : undefined),
      set: (record) => {
        if (!params.session || !record.snapshot) return;
        params.session.snapshot = record.snapshot;
        params.sessionStore.set(params.sessionName, params.session);
      },
    },
    policy: localCommandPolicy(),
  });
}

async function createSelectorRuntime(
  params: SelectorRuntimeParams,
  options: { requireSession: boolean; capability: 'find' | 'get' | 'is' },
): Promise<
  | { ok: true; runtime: ReturnType<typeof createSelectorRuntimeForDevice> }
  | { ok: false; response: DaemonResponse }
> {
  const session = params.sessionStore.get(params.sessionName);
  if (!session && options.requireSession) {
    return {
      ok: false,
      response: errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.'),
    };
  }
  const device = session?.device ?? (await resolveTargetDevice(params.req.flags ?? {}));
  if (!session) await ensureDeviceReady(device);
  if (!isCommandSupportedOnDevice(options.capability, device)) {
    return {
      ok: false,
      response: errorResponse(
        'UNSUPPORTED_OPERATION',
        `${options.capability} is not supported on this device`,
      ),
    };
  }
  return {
    ok: true,
    runtime: createSelectorRuntimeForDevice({
      ...params,
      session,
      device,
    }),
  };
}

function createSelectorBackend(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath?: string;
  sessionStore: SessionStore;
  contextFromFlags?: ContextFromFlags;
  session: SessionState | undefined;
  device: SessionState['device'];
}): AgentDeviceBackend {
  const { req, session, device, logPath, sessionName, sessionStore } = params;
  return {
    platform: device.platform,
    captureSnapshot: async (_context, options): Promise<BackendSnapshotResult> => {
      const flags = {
        ...req.flags,
        ...snapshotFlagOverrides(options),
      };
      const snapshotScope = options?.scope ?? req.flags?.snapshotScope;
      const capture = await captureSnapshot({
        device,
        session,
        flags,
        outPath: req.flags?.out,
        logPath: logPath ?? '',
        snapshotScope,
      });
      if (session) {
        session.snapshot = capture.snapshot;
        sessionStore.set(sessionName, session);
      }
      return { snapshot: capture.snapshot };
    },
    readText: async (_context, node: SnapshotNode) => ({
      text: await readTextForNode({
        device,
        node,
        flags: req.flags,
        appBundleId: session?.appBundleId,
        traceOutPath: session?.trace?.outPath,
        surface: session?.surface,
        contextFromFlags:
          params.contextFromFlags ??
          ((flags, appBundleId, traceLogPath) =>
            contextFromFlags(logPath ?? '', flags, appBundleId, traceLogPath)),
      }),
    }),
    findText: async (_context, text) => ({
      found: await findText(params, text),
    }),
  };
}

function snapshotFlagOverrides(options: BackendSnapshotOptions | undefined): SnapshotFlagOverrides {
  const flags: SnapshotFlagOverrides = {};
  if (options?.interactiveOnly !== undefined)
    flags.snapshotInteractiveOnly = options.interactiveOnly;
  if (options?.compact !== undefined) flags.snapshotCompact = options.compact;
  if (options?.scope !== undefined) flags.snapshotScope = options.scope;
  if (options?.depth !== undefined) flags.snapshotDepth = options.depth;
  if (options?.raw !== undefined) flags.snapshotRaw = options.raw;
  return flags;
}

async function findText(
  params: {
    req: DaemonRequest;
    sessionName: string;
    logPath?: string;
    sessionStore: SessionStore;
    contextFromFlags?: ContextFromFlags;
    session: SessionState | undefined;
    device: SessionState['device'];
  },
  text: string,
): Promise<boolean> {
  const { device, session, req, logPath } = params;
  if (device.platform === 'macos' && session?.surface && session.surface !== 'app') {
    const snapshot = await captureWaitSnapshot(params);
    return Boolean(findNodeByLabel(snapshot.nodes, text));
  }
  if (isApplePlatform(device.platform)) {
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
    return result?.found === true;
  }
  const snapshot = await captureWaitSnapshot(params);
  return Boolean(findNodeByLabel(snapshot.nodes, text));
}

async function captureWaitSnapshot(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath?: string;
  sessionStore: SessionStore;
  contextFromFlags?: ContextFromFlags;
  session: SessionState | undefined;
  device: SessionState['device'];
}) {
  const capture = await captureSnapshot({
    device: params.device,
    session: params.session,
    flags: {
      ...params.req.flags,
      snapshotInteractiveOnly: false,
      snapshotCompact: false,
    },
    outPath: params.req.flags?.out,
    logPath: params.logPath ?? '',
  });
  if (params.session) {
    params.session.snapshot = capture.snapshot;
    params.sessionStore.set(params.sessionName, params.session);
  }
  return capture.snapshot;
}

function parseGetTarget(req: DaemonRequest):
  | {
      ok: true;
      target:
        | { kind: 'ref'; ref: string; fallbackLabel?: string }
        | { kind: 'selector'; selector: string };
    }
  | { ok: false; response: DaemonResponse } {
  const refInput = req.positionals?.[1] ?? '';
  if (refInput.startsWith('@')) {
    return {
      ok: true,
      target: {
        kind: 'ref',
        ref: refInput,
        fallbackLabel: req.positionals.length > 2 ? req.positionals.slice(2).join(' ').trim() : '',
      },
    };
  }
  const selector = req.positionals?.slice(1).join(' ').trim() ?? '';
  if (!selector) {
    return {
      ok: false,
      response: errorResponse('INVALID_ARGS', 'get requires @ref or selector expression'),
    };
  }
  return { ok: true, target: { kind: 'selector', selector } };
}

function toWaitTarget(parsed: WaitParsed, session: SessionState | undefined) {
  if (parsed.kind === 'sleep') return { kind: 'sleep' as const, durationMs: parsed.durationMs };
  if (parsed.kind === 'selector') {
    return {
      kind: 'selector' as const,
      selector: parsed.selectorExpression,
      timeoutMs: parsed.timeoutMs,
    };
  }
  if (parsed.kind === 'ref') {
    if (!session?.snapshot) {
      throw new AppError('INVALID_ARGS', 'Ref wait requires an existing snapshot in session.');
    }
    return { kind: 'ref' as const, ref: parsed.rawRef, timeoutMs: parsed.timeoutMs };
  }
  if (!parsed.text) throw new AppError('INVALID_ARGS', 'wait requires text');
  return { kind: 'text' as const, text: parsed.text, timeoutMs: parsed.timeoutMs };
}

async function toDaemonResponse(
  task: () => Promise<Record<string, unknown>>,
): Promise<DaemonResponse> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    const appError = asAppError(error);
    return errorResponse(appError.code, appError.message, appError.details);
  }
}

function toCommandSession(session: SessionState | undefined) {
  if (!session) return undefined;
  return {
    name: session.name,
    appName: session.appName,
    appBundleId: session.appBundleId,
    snapshot: session.snapshot,
    metadata: { surface: session.surface },
  };
}

function isReadOnlyFindAction(
  action: FindAction['kind'],
): action is 'exists' | 'wait' | 'get_text' | 'get_attrs' {
  return (
    action === 'exists' || action === 'wait' || action === 'get_text' || action === 'get_attrs'
  );
}
