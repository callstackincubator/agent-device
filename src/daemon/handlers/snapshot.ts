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
import { uniqueStrings } from '../action-utils.ts';

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
      const warnings = buildSnapshotWarnings({
        capture,
        flags: req.flags,
        session,
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
          ...(warnings.length > 0 ? { warnings } : {}),
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
    return await handleSnapshotDiffRequest({ req, sessionName, logPath, sessionStore });
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

function buildSnapshotWarnings(params: {
  capture: Awaited<ReturnType<typeof captureSnapshot>>;
  flags: DaemonRequest['flags'];
  session: SessionState | undefined;
}): string[] {
  const { capture, flags, session } = params;
  const warnings: string[] = [];
  const analysis = capture.analysis;
  const interactiveOnly = flags?.snapshotInteractiveOnly === true;

  if (
    capture.snapshot.backend === 'android' &&
    interactiveOnly &&
    capture.snapshot.nodes.length === 0 &&
    analysis &&
    analysis.rawNodeCount >= 12
  ) {
    warnings.push(
      `Interactive snapshot is empty after filtering ${analysis.rawNodeCount} raw Android nodes. Likely causes: depth too low, transient route change, or collector filtering.`,
    );
    if (typeof flags?.snapshotDepth === 'number' && analysis.maxDepth >= flags.snapshotDepth + 2) {
      warnings.push(
        `Interactive output is empty at depth ${flags.snapshotDepth}; retry without -d.`,
      );
    }
  }

  const previousSnapshot = session?.snapshot;
  if (
    previousSnapshot &&
    Date.now() - previousSnapshot.createdAt <= 2_000 &&
    isLikelyStaleSnapshotDrop(previousSnapshot.nodes.length, capture.snapshot.nodes.length)
  ) {
    warnings.push(
      'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.',
    );
  }

  const recentAction = session?.actions.at(-1);
  if (
    capture.snapshot.backend === 'android' &&
    interactiveOnly &&
    previousSnapshot &&
    recentAction &&
    Date.now() - recentAction.ts <= 2_000 &&
    isLikelySnapshotStuckOnPreviousRoute(previousSnapshot.nodes, capture.snapshot.nodes) &&
    isNavigationSensitiveAction(recentAction.command)
  ) {
    warnings.push(
      `Recent ${recentAction.command} was followed by a nearly identical snapshot. If you expected navigation or submit, the tree may still be stale. Use screenshot as visual truth, wait briefly, then re-snapshot once.`,
    );
  }

  return uniqueStrings(warnings);
}

function isLikelyStaleSnapshotDrop(previousCount: number, currentCount: number): boolean {
  if (previousCount < 12) {
    return false;
  }
  return currentCount <= Math.floor(previousCount * 0.2);
}

function isNavigationSensitiveAction(command: string): boolean {
  return command === 'press' || command === 'click' || command === 'back' || command === 'open';
}

function isLikelySnapshotStuckOnPreviousRoute(
  previousNodes: NonNullable<SessionState['snapshot']>['nodes'],
  currentNodes: NonNullable<SessionState['snapshot']>['nodes'],
): boolean {
  const total = Math.max(previousNodes.length, currentNodes.length);
  if (total < 12) {
    return false;
  }
  const comparableLength = Math.min(previousNodes.length, currentNodes.length);
  let unchanged = 0;
  for (let index = 0; index < comparableLength; index += 1) {
    if (
      snapshotNodeSignature(previousNodes[index]) === snapshotNodeSignature(currentNodes[index])
    ) {
      unchanged += 1;
    }
  }
  const additions = Math.max(0, currentNodes.length - previousNodes.length);
  const removals = Math.max(0, previousNodes.length - currentNodes.length);
  const toleratedDelta = Math.max(3, Math.floor(total * 0.15));
  return (
    unchanged >= Math.floor(total * 0.9) &&
    additions <= toleratedDelta &&
    removals <= toleratedDelta
  );
}

function snapshotNodeSignature(
  node: NonNullable<SessionState['snapshot']>['nodes'][number],
): string {
  return [
    node.depth ?? 0,
    node.type ?? '',
    node.role ?? '',
    node.label ?? '',
    node.value ?? '',
    node.identifier ?? '',
    node.enabled === false ? 'disabled' : 'enabled',
    node.selected === true ? 'selected' : 'unselected',
    node.hittable === true ? 'hittable' : 'not-hittable',
  ].join('|');
}

async function handleSnapshotDiffRequest(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;
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
    const warnings = buildSnapshotWarnings({
      capture,
      flags: req.flags,
      session,
    });

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
          ...(warnings.length > 0 ? { warnings } : {}),
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
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  });
}
