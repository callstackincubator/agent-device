import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { errorResponse } from './response.ts';
import { DAEMON_COMMAND_GROUPS } from '../../command-catalog.ts';
import { handleAlertCommand } from './snapshot-alert.ts';
import { handleSettingsCommand, parseSettingsArgs } from './snapshot-settings.ts';
import { dispatchSnapshotDiffViaRuntime, dispatchSnapshotViaRuntime } from '../snapshot-runtime.ts';
import { dispatchWaitViaRuntime } from '../selector-runtime.ts';
import { resolveSessionDevice, withSessionlessRunnerCleanup } from './snapshot-session.ts';

const SNAPSHOT_COMMANDS = DAEMON_COMMAND_GROUPS.snapshot;

type SnapshotCommandParams = {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
};

type SnapshotCommandHandler = (params: SnapshotCommandParams) => Promise<DaemonResponse>;

export const SNAPSHOT_COMMAND_HANDLERS = {
  snapshot: async ({ req, sessionName, logPath, sessionStore }) =>
    await dispatchSnapshotViaRuntime({
      req,
      sessionName,
      logPath,
      sessionStore,
    }),
  diff: async ({ req, sessionName, logPath, sessionStore }) => {
    if (req.positionals?.[0] !== 'snapshot') {
      return errorResponse('INVALID_ARGS', 'diff currently supports only: diff snapshot');
    }
    return await dispatchSnapshotDiffViaRuntime({ req, sessionName, logPath, sessionStore });
  },
  wait: async ({ req, sessionName, logPath, sessionStore }) =>
    await dispatchWaitViaRuntime({ req, sessionName, logPath, sessionStore }),
  alert: async ({ req, sessionName, logPath, sessionStore }) => {
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
  },
  settings: async ({ req, sessionName, logPath, sessionStore }) => {
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
  },
} satisfies Record<string, SnapshotCommandHandler>;

export async function handleSnapshotCommands(
  params: SnapshotCommandParams,
): Promise<DaemonResponse | null> {
  const command = params.req.command;

  if (!SNAPSHOT_COMMANDS.has(command)) {
    return null;
  }

  const handler = SNAPSHOT_COMMAND_HANDLERS[command as keyof typeof SNAPSHOT_COMMAND_HANDLERS];
  if (!handler) {
    return errorResponse('COMMAND_FAILED', `Snapshot command has no handler: ${command}`);
  }

  return await handler(params);
}
