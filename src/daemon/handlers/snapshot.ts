import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { errorResponse } from './response.ts';
import { parseWaitArgs } from './snapshot-wait.ts';
import { handleAlertCommand } from './snapshot-alert.ts';
import { handleSettingsCommand, parseSettingsArgs } from './snapshot-settings.ts';
import { dispatchSnapshotDiffViaRuntime, dispatchSnapshotViaRuntime } from '../snapshot-runtime.ts';
import { dispatchWaitViaRuntime } from '../selector-runtime.ts';
import { resolveSessionDevice, withSessionlessRunnerCleanup } from './snapshot-session.ts';

const SNAPSHOT_COMMANDS = new Set(['snapshot', 'diff', 'wait', 'alert', 'settings']);

export { parseWaitArgs };

export async function handleSnapshotCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore } = params;
  const command = req.command;

  if (!SNAPSHOT_COMMANDS.has(command)) {
    return null;
  }

  if (command === 'snapshot') {
    return await dispatchSnapshotViaRuntime({
      req,
      sessionName,
      logPath,
      sessionStore,
    });
  }

  if (command === 'diff') {
    if (req.positionals?.[0] !== 'snapshot') {
      return errorResponse('INVALID_ARGS', 'diff currently supports only: diff snapshot');
    }
    return await dispatchSnapshotDiffViaRuntime({ req, sessionName, logPath, sessionStore });
  }

  if (command === 'wait') {
    return await dispatchWaitViaRuntime({ req, sessionName, logPath, sessionStore });
  }

  if (command === 'alert') {
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    return await withSessionlessRunnerCleanup(session, device, async () => {
      return await handleAlertCommand({
        req,
        logPath,
        sessionStore,
        session,
        device,
      });
    });
  }

  if (command === 'settings') {
    const parsedSettings = parseSettingsArgs(req);
    if (!parsedSettings.ok) return parsedSettings;
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    return await withSessionlessRunnerCleanup(session, device, async () => {
      return await handleSettingsCommand({
        req,
        logPath,
        sessionStore,
        session,
        device,
        parsed: parsedSettings.parsed,
      });
    });
  }

  return null;
}
