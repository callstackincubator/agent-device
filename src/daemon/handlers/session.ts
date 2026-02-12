import fs from 'node:fs';
import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { AppError, asAppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse, SessionAction, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { resolveIosAppStateFromSnapshots } from '../app-state.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { attachRefs, type RawSnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { pruneGroupNodes } from '../snapshot-processing.ts';
import { buildSelectorChainForNode, parseSelectorChain, resolveSelectorChain, splitSelectorFromArgs } from '../selectors.ts';
import { inferFillText, uniqueStrings } from '../action-utils.ts';

export async function handleSessionCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  dispatch?: typeof dispatchCommand;
  ensureReady?: typeof ensureDeviceReady;
}): Promise<DaemonResponse | null> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
    dispatch: dispatchOverride,
    ensureReady: ensureReadyOverride,
  } = params;
  const dispatch = dispatchOverride ?? dispatchCommand;
  const ensureReady = ensureReadyOverride ?? ensureDeviceReady;
  const command = req.command;

  if (command === 'session_list') {
    const data = {
      sessions: sessionStore.toArray().map((s) => ({
        name: s.name,
        platform: s.device.platform,
        device: s.device.name,
        id: s.device.id,
        createdAt: s.createdAt,
      })),
    };
    return { ok: true, data };
  }

  if (command === 'devices') {
    try {
      const devices: DeviceInfo[] = [];
      if (req.flags?.platform === 'android') {
        const { listAndroidDevices } = await import('../../platforms/android/devices.ts');
        devices.push(...(await listAndroidDevices()));
      } else if (req.flags?.platform === 'ios') {
        const { listIosDevices } = await import('../../platforms/ios/devices.ts');
        devices.push(...(await listIosDevices()));
      } else {
        const { listAndroidDevices } = await import('../../platforms/android/devices.ts');
        const { listIosDevices } = await import('../../platforms/ios/devices.ts');
        try {
          devices.push(...(await listAndroidDevices()));
        } catch {
          // ignore
        }
        try {
          devices.push(...(await listIosDevices()));
        } catch {
          // ignore
        }
      }
      return { ok: true, data: { devices } };
    } catch (err) {
      const appErr = asAppError(err);
      return { ok: false, error: { code: appErr.code, message: appErr.message, details: appErr.details } };
    }
  }

  if (command === 'apps') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    if (!session && !flags.platform && !flags.device && !flags.udid && !flags.serial) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'apps requires an active session or an explicit device selector (e.g. --platform ios).',
        },
      };
    }
    const device = session?.device ?? (await resolveTargetDevice(flags));
    await ensureReady(device);
    if (!isCommandSupportedOnDevice('apps', device)) {
      return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'apps is not supported on this device' } };
    }
    if (device.platform === 'ios') {
      const { listSimulatorApps } = await import('../../platforms/ios/index.ts');
      const apps = await listSimulatorApps(device);
      if (req.flags?.appsMetadata) {
        return { ok: true, data: { apps } };
      }
      const formatted = apps.map((app) =>
        app.name && app.name !== app.bundleId ? `${app.name} (${app.bundleId})` : app.bundleId,
      );
      return { ok: true, data: { apps: formatted } };
    }
    const { listAndroidApps, listAndroidAppsMetadata } = await import('../../platforms/android/index.ts');
    if (req.flags?.appsMetadata) {
      const apps = await listAndroidAppsMetadata(device, req.flags?.appsFilter);
      return { ok: true, data: { apps } };
    }
    const apps = await listAndroidApps(device, req.flags?.appsFilter);
    return { ok: true, data: { apps } };
  }

  if (command === 'boot') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    if (!session && !flags.platform && !flags.device && !flags.udid && !flags.serial) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'boot requires an active session or an explicit device selector (e.g. --platform ios).',
        },
      };
    }
    const device = session?.device ?? (await resolveTargetDevice(flags));
    if (!isCommandSupportedOnDevice('boot', device)) {
      return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'boot is not supported on this device' } };
    }
    await ensureReady(device);
    return {
      ok: true,
      data: {
        platform: device.platform,
        device: device.name,
        id: device.id,
        kind: device.kind,
        booted: true,
      },
    };
  }

  if (command === 'appstate') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const device = session?.device ?? (await resolveTargetDevice(flags));
    await ensureReady(device);
    if (device.platform === 'ios') {
      if (session?.appBundleId) {
        return {
          ok: true,
          data: {
            platform: 'ios',
            appBundleId: session.appBundleId,
            appName: session.appName ?? session.appBundleId,
            source: 'session',
          },
        };
      }
      const snapshotResult = await resolveIosAppStateFromSnapshots(
        device,
        logPath,
        session?.trace?.outPath,
        req.flags,
      );
      return {
        ok: true,
        data: {
          platform: 'ios',
          appName: snapshotResult.appName,
          appBundleId: snapshotResult.appBundleId,
          source: snapshotResult.source,
        },
      };
    }
    const { getAndroidAppState } = await import('../../platforms/android/index.ts');
    const state = await getAndroidAppState(device);
    return {
      ok: true,
      data: {
        platform: 'android',
        package: state.package,
        activity: state.activity,
      },
    };
  }

  if (command === 'open') {
    if (sessionStore.has(sessionName)) {
      const session = sessionStore.get(sessionName);
      const appName = req.positionals?.[0];
      if (!session || !appName) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'Session already active. Close it first or pass a new --session name.',
          },
        };
      }
      let appBundleId: string | undefined;
      if (session.device.platform === 'ios') {
        try {
          const { resolveIosApp } = await import('../../platforms/ios/index.ts');
          appBundleId = await resolveIosApp(session.device, appName);
        } catch {
          appBundleId = undefined;
        }
      }
      await dispatch(session.device, 'open', req.positionals ?? [], req.flags?.out, {
        ...contextFromFlags(logPath, req.flags, appBundleId),
      });
      const nextSession: SessionState = {
        ...session,
        appBundleId,
        appName,
        recordSession: session.recordSession || req.flags?.saveScript === true,
        snapshot: undefined,
      };
      sessionStore.recordAction(nextSession, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { session: sessionName, appName, appBundleId },
      });
      sessionStore.set(sessionName, nextSession);
      return { ok: true, data: { session: sessionName, appName, appBundleId } };
    }
    const device = await resolveTargetDevice(req.flags ?? {});
    await ensureDeviceReady(device);
    const inUse = sessionStore.toArray().find((s) => s.device.id === device.id);
    if (inUse) {
      return {
        ok: false,
        error: {
          code: 'DEVICE_IN_USE',
          message: `Device is already in use by session "${inUse.name}".`,
          details: { session: inUse.name, deviceId: device.id, deviceName: device.name },
        },
      };
    }
    let appBundleId: string | undefined;
    const appName = req.positionals?.[0];
    if (device.platform === 'ios') {
      try {
        const { resolveIosApp } = await import('../../platforms/ios/index.ts');
        appBundleId = await resolveIosApp(device, req.positionals?.[0] ?? '');
      } catch {
        appBundleId = undefined;
      }
    }
    await dispatch(device, 'open', req.positionals ?? [], req.flags?.out, {
      ...contextFromFlags(logPath, req.flags, appBundleId),
    });
    const session: SessionState = {
      name: sessionName,
      device,
      createdAt: Date.now(),
      appBundleId,
      appName,
      recordSession: req.flags?.saveScript === true,
      actions: [],
    };
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { session: sessionName },
    });
    sessionStore.set(sessionName, session);
    return { ok: true, data: { session: sessionName } };
  }

  if (command === 'replay') {
    const filePath = req.positionals?.[0];
    if (!filePath) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'replay requires a path' } };
    }
    try {
      const resolved = SessionStore.expandHome(filePath);
      const script = fs.readFileSync(resolved, 'utf8');
      const firstNonWhitespace = script.trimStart()[0];
      if (firstNonWhitespace === '{' || firstNonWhitespace === '[') {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'replay accepts .ad script files. JSON replay payloads are no longer supported.',
          },
        };
      }
      const actions = parseReplayScript(script);
      const shouldUpdate = req.flags?.replayUpdate === true;
      let healed = 0;
      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        if (!action || action.command === 'replay') continue;
        let response = await invoke({
          token: req.token,
          session: sessionName,
          command: action.command,
          positionals: action.positionals ?? [],
          flags: action.flags ?? {},
        });
        if (response.ok) continue;
        if (!shouldUpdate) {
          return withReplayFailureContext(response, action, index, resolved);
        }
        const nextAction = await healReplayAction({
          action,
          sessionName,
          logPath,
          sessionStore,
          dispatch,
        });
        if (!nextAction) {
          return withReplayFailureContext(response, action, index, resolved);
        }
        actions[index] = nextAction;
        response = await invoke({
          token: req.token,
          session: sessionName,
          command: nextAction.command,
          positionals: nextAction.positionals ?? [],
          flags: nextAction.flags ?? {},
        });
        if (!response.ok) {
          return withReplayFailureContext(response, nextAction, index, resolved);
        }
        healed += 1;
      }
      if (shouldUpdate && healed > 0) {
        const session = sessionStore.get(sessionName);
        writeReplayScript(resolved, actions, session);
      }
      return { ok: true, data: { replayed: actions.length, healed, session: sessionName } };
    } catch (err) {
      const appErr = asAppError(err);
      return { ok: false, error: { code: appErr.code, message: appErr.message } };
    }
  }

  if (command === 'close') {
    const session = sessionStore.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (req.positionals && req.positionals.length > 0) {
      await dispatch(session.device, 'close', req.positionals ?? [], req.flags?.out, {
        ...contextFromFlags(logPath, req.flags, session.appBundleId, session.trace?.outPath),
      });
    }
    if (session.device.platform === 'ios' && session.device.kind === 'simulator') {
      await stopIosRunnerSession(session.device.id);
    }
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { session: sessionName },
    });
    if (req.flags?.saveScript) {
      session.recordSession = true;
    }
    sessionStore.writeSessionLog(session);
    sessionStore.delete(sessionName);
    return { ok: true, data: { session: sessionName } };
  }

  return null;
}

function withReplayFailureContext(
  response: DaemonResponse,
  action: SessionAction,
  index: number,
  replayPath: string,
): DaemonResponse {
  if (response.ok) return response;
  const step = index + 1;
  const summary = formatReplayActionSummary(action);
  const details = {
    ...(response.error.details ?? {}),
    replayPath,
    step,
    action: action.command,
    positionals: action.positionals ?? [],
  };
  return {
    ok: false,
    error: {
      code: response.error.code,
      message: `Replay failed at step ${step} (${summary}): ${response.error.message}`,
      details,
    },
  };
}

function formatReplayActionSummary(action: SessionAction): string {
  const values = (action.positionals ?? []).map((value) => {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    if (trimmed.startsWith('@')) return trimmed;
    return JSON.stringify(trimmed);
  });
  return [action.command, ...values].join(' ');
}

async function healReplayAction(params: {
  action: SessionAction;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatch: typeof dispatchCommand;
}): Promise<SessionAction | null> {
  const { action, sessionName, logPath, sessionStore, dispatch } = params;
  if (!['click', 'fill', 'get', 'is', 'wait'].includes(action.command)) return null;
  const session = sessionStore.get(sessionName);
  if (!session) return null;
  const requiresRect = action.command === 'click' || action.command === 'fill';
  const snapshot = await captureSnapshotForReplay(session, action, logPath, requiresRect, dispatch, sessionStore);
  const selectorCandidates = collectReplaySelectorCandidates(action);
  for (const candidate of selectorCandidates) {
    const chain = parseSelectorChain(candidate);
    const resolved = resolveSelectorChain(snapshot.nodes, chain, {
      platform: session.device.platform,
      requireRect: requiresRect,
      requireUnique: true,
    });
    if (!resolved) continue;
    const selectorChain = buildSelectorChainForNode(resolved.node, session.device.platform, {
      action: action.command === 'click' ? 'click' : action.command === 'fill' ? 'fill' : 'get',
    });
    const selectorExpression = selectorChain.join(' || ');
    if (action.command === 'click') {
      return {
        ...action,
        positionals: [selectorExpression],
      };
    }
    if (action.command === 'fill') {
      const fillText = inferFillText(action);
      if (!fillText) continue;
      return {
        ...action,
        positionals: [selectorExpression, fillText],
      };
    }
    if (action.command === 'get') {
      const sub = action.positionals?.[0];
      if (sub !== 'text' && sub !== 'attrs') continue;
      return {
        ...action,
        positionals: [sub, selectorExpression],
      };
    }
    if (action.command === 'is') {
      const predicate = action.positionals?.[0];
      if (!predicate) continue;
      const split = splitSelectorFromArgs(action.positionals.slice(1));
      const expectedText = split?.rest.join(' ').trim() ?? '';
      const nextPositionals = [predicate, selectorExpression];
      if (predicate === 'text' && expectedText.length > 0) {
        nextPositionals.push(expectedText);
      }
      return {
        ...action,
        positionals: nextPositionals,
      };
    }
    if (action.command === 'wait') {
      const { selectorTimeout } = parseSelectorWaitPositionals(action.positionals ?? []);
      const nextPositionals = [selectorExpression];
      if (selectorTimeout) {
        nextPositionals.push(selectorTimeout);
      }
      return {
        ...action,
        positionals: nextPositionals,
      };
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
    backend?: 'ax' | 'xctest' | 'android';
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

function collectReplaySelectorCandidates(action: SessionAction): string[] {
  const result: string[] = [];
  const explicitChain =
    Array.isArray(action.result?.selectorChain) &&
    action.result?.selectorChain.every((entry) => typeof entry === 'string')
      ? (action.result.selectorChain as string[])
      : [];
  result.push(...explicitChain);

  if (action.command === 'click') {
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
    const split = splitSelectorFromArgs(action.positionals.slice(1));
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

function parseSelectorWaitPositionals(positionals: string[]): {
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

function parseReplayScript(script: string): SessionAction[] {
  const actions: SessionAction[] = [];
  const lines = script.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseReplayScriptLine(line);
    if (parsed) {
      actions.push(parsed);
    }
  }
  return actions;
}

function parseReplayScriptLine(line: string): SessionAction | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null;
  const tokens = tokenizeReplayLine(trimmed);
  if (tokens.length === 0) return null;
  const [command, ...args] = tokens;
  if (command === 'context') return null;

  const action: SessionAction = {
    ts: Date.now(),
    command,
    positionals: [],
    flags: {},
  };

  if (command === 'snapshot') {
    action.positionals = [];
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === '-i') {
        action.flags.snapshotInteractiveOnly = true;
        continue;
      }
      if (token === '-c') {
        action.flags.snapshotCompact = true;
        continue;
      }
      if (token === '--raw') {
        action.flags.snapshotRaw = true;
        continue;
      }
      if ((token === '-d' || token === '--depth') && index + 1 < args.length) {
        const parsedDepth = Number(args[index + 1]);
        if (Number.isFinite(parsedDepth) && parsedDepth >= 0) {
          action.flags.snapshotDepth = Math.floor(parsedDepth);
        }
        index += 1;
        continue;
      }
      if ((token === '-s' || token === '--scope') && index + 1 < args.length) {
        action.flags.snapshotScope = args[index + 1];
        index += 1;
        continue;
      }
      if (token === '--backend' && index + 1 < args.length) {
        const backend = args[index + 1];
        if (backend === 'ax' || backend === 'xctest') {
          action.flags.snapshotBackend = backend;
        }
        index += 1;
      }
    }
    return action;
  }

  if (command === 'click') {
    if (args.length === 0) return action;
    const target = args[0];
    if (target.startsWith('@')) {
      action.positionals = [target];
      if (args[1]) {
        action.result = { refLabel: args[1] };
      }
      return action;
    }
    action.positionals = [args.join(' ')];
    return action;
  }

  if (command === 'fill') {
    if (args.length < 2) {
      action.positionals = args;
      return action;
    }
    const target = args[0];
    if (target.startsWith('@')) {
      if (args.length >= 3) {
        action.positionals = [target, args.slice(2).join(' ')];
        action.result = { refLabel: args[1] };
        return action;
      }
      action.positionals = [target, args[1]];
      return action;
    }
    action.positionals = [target, args.slice(1).join(' ')];
    return action;
  }

  if (command === 'get') {
    if (args.length < 2) {
      action.positionals = args;
      return action;
    }
    const sub = args[0];
    const target = args[1];
    if (target.startsWith('@')) {
      action.positionals = [sub, target];
      if (args[2]) {
        action.result = { refLabel: args[2] };
      }
      return action;
    }
    action.positionals = [sub, args.slice(1).join(' ')];
    return action;
  }

  action.positionals = args;
  return action;
}

function tokenizeReplayLine(line: string): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor])) {
      cursor += 1;
    }
    if (cursor >= line.length) break;
    if (line[cursor] === '"') {
      let end = cursor + 1;
      let escaped = false;
      while (end < line.length) {
        const char = line[end];
        if (char === '"' && !escaped) break;
        escaped = char === '\\' && !escaped;
        if (char !== '\\') escaped = false;
        end += 1;
      }
      if (end >= line.length) {
        throw new AppError('INVALID_ARGS', `Invalid replay script line: ${line}`);
      }
      const literal = line.slice(cursor, end + 1);
      tokens.push(JSON.parse(literal) as string);
      cursor = end + 1;
      continue;
    }
    let end = cursor;
    while (end < line.length && !/\s/.test(line[end])) {
      end += 1;
    }
    tokens.push(line.slice(cursor, end));
    cursor = end;
  }
  return tokens;
}

function writeReplayScript(filePath: string, actions: SessionAction[], session?: SessionState) {
  const lines: string[] = [];
  // Session can be missing if the replay session is closed/deleted between execution and update write.
  // In that case we still persist healed actions and omit only the context header.
  if (session) {
    const deviceLabel = session.device.name.replace(/"/g, '\\"');
    const kind = session.device.kind ? ` kind=${session.device.kind}` : '';
    lines.push(`context platform=${session.device.platform} device="${deviceLabel}"${kind} theme=unknown`);
  }
  for (const action of actions) {
    lines.push(formatReplayActionLine(action));
  }
  const serialized = `${lines.join('\n')}\n`;
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, serialized);
  fs.renameSync(tmpPath, filePath);
}

function formatReplayActionLine(action: SessionAction): string {
  const parts: string[] = [action.command];
  if (action.command === 'snapshot') {
    if (action.flags?.snapshotInteractiveOnly) parts.push('-i');
    if (action.flags?.snapshotCompact) parts.push('-c');
    if (typeof action.flags?.snapshotDepth === 'number') {
      parts.push('-d', String(action.flags.snapshotDepth));
    }
    if (action.flags?.snapshotScope) {
      parts.push('-s', formatReplayArg(action.flags.snapshotScope));
    }
    if (action.flags?.snapshotRaw) parts.push('--raw');
    if (action.flags?.snapshotBackend) {
      parts.push('--backend', action.flags.snapshotBackend);
    }
    return parts.join(' ');
  }
  for (const positional of action.positionals ?? []) {
    parts.push(formatReplayArg(positional));
  }
  return parts.join(' ');
}

function formatReplayArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}
