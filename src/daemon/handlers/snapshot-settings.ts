import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { SETTINGS_INVALID_ARGS_MESSAGE } from '../../core/settings-contract.ts';
import { dispatchCommand } from '../../core/dispatch.ts';
import { contextFromFlags } from '../context.ts';
import { SessionStore } from '../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { recordIfSession } from './snapshot-session.ts';

type HandleSettingsCommandParams = {
  req: DaemonRequest;
  logPath: string;
  sessionStore: SessionStore;
  session: SessionState | undefined;
  device: SessionState['device'];
};

export async function handleSettingsCommand(
  params: HandleSettingsCommandParams,
): Promise<DaemonResponse> {
  const { req, logPath, sessionStore, session, device } = params;
  const setting = req.positionals?.[0]?.toLowerCase();
  const state = req.positionals?.[1]?.toLowerCase();
  const permissionTarget = req.positionals?.[2]?.toLowerCase();
  if (!setting || !state || (setting === 'permission' && !permissionTarget)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: SETTINGS_INVALID_ARGS_MESSAGE,
      },
    };
  }
  if (!isCommandSupportedOnDevice('settings', device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'settings is not supported on this device',
      },
    };
  }

  const appBundleId = session?.appBundleId;
  // Settings positional layout for dispatch: setting, state, [target, mode], appBundleId.
  const positionals =
    setting === 'permission'
      ? [setting, state, permissionTarget, req.positionals?.[3] ?? '', appBundleId ?? '']
      : [setting, state, appBundleId ?? ''];
  const data = await dispatchCommand(device, 'settings', positionals, req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, appBundleId, session?.trace?.outPath),
  });
  recordIfSession(sessionStore, session, req, data ?? { setting, state });
  return { ok: true, data: data ?? { setting, state } };
}
