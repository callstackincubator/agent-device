import { dispatchCommand } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
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

export { parseWaitArgs };

export async function handleSnapshotCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatchSnapshotCommand?: typeof dispatchCommand;
  runnerCommand?: typeof runIosRunnerCommand;
  sessionlessRunnerCleanup?: typeof withSessionlessRunnerCleanup;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore } = params;
  const dispatchSnapshotCommand = params.dispatchSnapshotCommand ?? dispatchCommand;
  const runnerCommand = params.runnerCommand ?? runIosRunnerCommand;
  const sessionlessRunnerCleanup = params.sessionlessRunnerCleanup ?? withSessionlessRunnerCleanup;
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

    return await sessionlessRunnerCleanup(session, device, async () => {
      const capture = await captureSnapshot({
        dispatchSnapshotCommand,
        device,
        session,
        req,
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

    return await sessionlessRunnerCleanup(session, device, async () => {
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
        dispatchSnapshotCommand,
        runnerCommand,
      });
    if (!waitNeedsRunnerCleanup(parsed)) {
      return await executeWait();
    }
    return await sessionlessRunnerCleanup(session, device, executeWait);
  }

  if (command === 'alert') {
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    return await sessionlessRunnerCleanup(session, device, async () => {
      return await handleAlertCommand({
        req,
        logPath,
        sessionStore,
        session,
        device,
        runnerCommand,
      });
    });
  }

  if (command === 'settings') {
    const parsedSettings = parseSettingsArgs(req);
    if (!parsedSettings.ok) return parsedSettings.response;
    const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
    return await sessionlessRunnerCleanup(session, device, async () => {
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
