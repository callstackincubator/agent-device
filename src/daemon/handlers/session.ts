import fs from 'node:fs';
import { dispatchCommand, resolveTargetDevice } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { asAppError } from '../../utils/errors.ts';
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
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore, invoke, dispatch: dispatchOverride } = params;
  const dispatch = dispatchOverride ?? dispatchCommand;
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
    await ensureDeviceReady(device);
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

  if (command === 'appstate') {
    const session = sessionStore.get(sessionName);
    const flags = req.flags ?? {};
    const device = session?.device ?? (await resolveTargetDevice(flags));
    await ensureDeviceReady(device);
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
      const payload = JSON.parse(fs.readFileSync(resolved, 'utf8')) as {
        actions?: SessionAction[];
        optimizedActions?: SessionAction[];
      };
      const actions = payload.optimizedActions ?? payload.actions ?? [];
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
        if (!shouldUpdate) return response;
        const nextAction = await healReplayAction({
          action,
          sessionName,
          logPath,
          sessionStore,
          dispatch,
        });
        if (!nextAction) {
          return response;
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
          return response;
        }
        healed += 1;
      }
      if (shouldUpdate && healed > 0) {
        writeReplayPayload(resolved, payload);
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
    sessionStore.writeSessionLog(session);
    sessionStore.delete(sessionName);
    return { ok: true, data: { session: sessionName } };
  }

  return null;
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

function writeReplayPayload(filePath: string, payload: { actions?: SessionAction[]; optimizedActions?: SessionAction[] }) {
  const serialized = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, serialized);
  fs.renameSync(tmpPath, filePath);
}
