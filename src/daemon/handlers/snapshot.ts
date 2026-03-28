import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { buildSnapshotDiff, countSnapshotComparableLines } from '../snapshot-diff.ts';
import { captureSnapshot, resolveSnapshotScope } from './snapshot-capture.ts';
import {
  buildSnapshotSession,
  recordIfSession,
  resolveSessionDevice,
  withSessionlessRunnerCleanup,
} from './snapshot-session.ts';
import { handleWaitCommand, parseWaitArgs, waitNeedsRunnerCleanup } from './snapshot-wait.ts';
import { handleAlertCommand } from './snapshot-alert.ts';
import { handleSettingsCommand, parseSettingsArgs } from './snapshot-settings.ts';

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
      const capture = await captureSnapshot({
        device,
        session,
        flags: req.flags,
        outPath: req.flags?.out,
        logPath,
        snapshotScope: resolvedScope.scope,
      });
      const nextSession = buildSnapshotSession({
        session,
        sessionName,
        device,
        snapshot: capture.snapshot,
        appBundleId: session?.appBundleId,
      });
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
    const flattenForDiff = req.flags?.snapshotInteractiveOnly === true;

    return await withSessionlessRunnerCleanup(session, device, async () => {
      const capture = await captureSnapshot({
        device,
        session,
        flags: req.flags,
        outPath: req.flags?.out,
        logPath,
        snapshotScope: resolvedScope.scope,
      });
      const currentSnapshot = capture.snapshot;

      if (!session?.snapshot) {
        const unchanged = countSnapshotComparableLines(currentSnapshot.nodes, {
          flatten: flattenForDiff,
        });
        const nextSession = buildSnapshotSession({
          session,
          sessionName,
          device,
          snapshot: currentSnapshot,
          appBundleId: session?.appBundleId,
        });
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

      const diff = buildSnapshotDiff(session.snapshot.nodes, currentSnapshot.nodes, {
        flatten: flattenForDiff,
      });
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
    const parsed = parseWaitArgs(req.positionals ?? []);
    if (!parsed) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'wait requires a duration or text' },
      };
    }
    const executeWait = () =>
      handleWaitCommand({
        parsed,
        req,
        sessionName,
        logPath,
        sessionStore,
        session,
        device,
      });
    if (!waitNeedsRunnerCleanup(parsed)) {
      return await executeWait();
    }
    return await withSessionlessRunnerCleanup(session, device, executeWait);
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
    if (!parsedSettings.ok) return parsedSettings.response;
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
