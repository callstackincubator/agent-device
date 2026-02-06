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

export async function handleSessionCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore, invoke } = params;
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
      await dispatchCommand(session.device, 'open', req.positionals ?? [], req.flags?.out, {
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
    await dispatchCommand(device, 'open', req.positionals ?? [], req.flags?.out, {
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
      for (const action of actions) {
        if (!action || action.command === 'replay') continue;
        await invoke({
          token: req.token,
          session: sessionName,
          command: action.command,
          positionals: action.positionals ?? [],
          flags: action.flags ?? {},
        });
      }
      return { ok: true, data: { replayed: actions.length, session: sessionName } };
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
      await dispatchCommand(session.device, 'close', req.positionals ?? [], req.flags?.out, {
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
