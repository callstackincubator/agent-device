import { dispatchCommand, type CommandFlags } from '../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../core/capabilities.ts';
import { SessionStore } from './session-store.ts';
import type { DaemonCommandContext } from './context.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from './types.ts';
import { buildSnapshotState, captureSnapshotData } from './handlers/snapshot-capture.ts';
import { setSessionSnapshot } from './session-snapshot.ts';
import {
  dispatchScreenshotViaRuntime,
  type ScreenshotOutputPlacement,
} from './screenshot-runtime.ts';
import { recoverAndroidBlockingSystemDialog } from './android-system-dialog.ts';
import { annotateScreenshotWithRefs } from './screenshot-overlay.ts';
import {
  isNavigationSensitiveAction,
  markAndroidSnapshotFreshness,
} from './android-snapshot-freshness.ts';
import {
  augmentScrollVisualizationResult,
  recordTouchVisualizationEvent,
} from './recording-gestures.ts';
import { markPostGestureStabilization } from './post-gesture-stabilization.ts';

export async function dispatchGenericCommand(params: {
  req: DaemonRequest;
  session: SessionState;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  contextFromFlags: (
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ) => DaemonCommandContext;
}): Promise<DaemonResponse> {
  const { req, session, logPath, sessionStore, contextFromFlags } = params;
  const command = req.command;

  if (!isCommandSupportedOnDevice(command, session.device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `${command} is not supported on this device`,
      },
    };
  }

  if (session.device.platform === 'android' && session.recording && command !== 'record') {
    const androidRecoveryResult = await recoverAndroidBlockingSystemDialog({ session });
    if (androidRecoveryResult === 'failed') {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: 'Android system dialog blocked the recording session',
        },
      };
    }
  }

  const { resolvedPositionals, resolvedOut, recordedPositionals, recordedFlags } =
    resolveCommandPositionals(req);

  const actionStartedAt = Date.now();
  const dispatchContext = {
    ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
    surface: session.surface,
  };
  const data =
    command === 'screenshot'
      ? await dispatchScreenshotViaRuntime({
          session,
          sessionName: params.sessionName,
          outPath: resolvedPositionals[0] ?? resolvedOut,
          outputPlacement: resolveScreenshotOutputPlacement(req),
          dispatchContext,
        })
      : await dispatchCommand(session.device, command, resolvedPositionals, resolvedOut, {
          ...dispatchContext,
        });

  if (command === 'screenshot' && req.flags?.overlayRefs && typeof data?.path === 'string') {
    await applyScreenshotOverlay(session, data, logPath);
  }

  const actionFinishedAt = Date.now();
  recordVisualizationAndAction({
    session,
    sessionStore,
    command,
    resolvedPositionals,
    recordedPositionals,
    recordedFlags,
    data,
    actionStartedAt,
    actionFinishedAt,
    flags: req.flags ?? {},
  });

  if (isNavigationSensitiveAction(command)) {
    markAndroidSnapshotFreshness(session, command);
  }
  markPostGestureStabilization(session, command);

  return { ok: true, data: data ?? {} };
}

function resolveScreenshotOutputPlacement(req: DaemonRequest): ScreenshotOutputPlacement {
  if (req.command !== 'screenshot') return 'default';
  if ((req.positionals ?? [])[0]) return 'positional';
  if (req.flags?.out) return 'out';
  return 'default';
}

function resolveCommandPositionals(req: DaemonRequest): {
  resolvedPositionals: string[];
  resolvedOut: string | undefined;
  recordedPositionals: string[];
  recordedFlags: Record<string, unknown>;
} {
  return req.command === 'screenshot'
    ? resolveScreenshotCommandPositionals(req)
    : resolveDefaultCommandPositionals(req);
}

function resolveDefaultCommandPositionals(req: DaemonRequest): {
  resolvedPositionals: string[];
  resolvedOut: string | undefined;
  recordedPositionals: string[];
  recordedFlags: Record<string, unknown>;
} {
  const positionals = req.positionals ?? [];
  return {
    resolvedPositionals: positionals,
    resolvedOut: req.flags?.out,
    recordedPositionals: positionals,
    recordedFlags: req.flags ?? {},
  };
}

function resolveScreenshotCommandPositionals(req: DaemonRequest): {
  resolvedPositionals: string[];
  resolvedOut: string | undefined;
  recordedPositionals: string[];
  recordedFlags: Record<string, unknown>;
} {
  const positionals = req.positionals ?? [];
  const resolvedPositionals = resolveScreenshotPositionals(positionals, req.meta?.cwd);
  const resolvedOut = resolveScreenshotOut(req.flags?.out, req.meta?.cwd);
  const recordedPositionals = resolvedPositionals;
  const recordedFlags = resolvedOut
    ? { ...(req.flags ?? {}), out: resolvedOut }
    : (req.flags ?? {});
  return { resolvedPositionals, resolvedOut, recordedPositionals, recordedFlags };
}

function resolveScreenshotPositionals(positionals: string[], cwd: string | undefined): string[] {
  const outPath = positionals[0];
  if (!outPath) return positionals;
  return [SessionStore.expandHome(outPath, cwd), ...positionals.slice(1)];
}

function resolveScreenshotOut(
  out: string | undefined,
  cwd: string | undefined,
): string | undefined {
  return out ? SessionStore.expandHome(out, cwd) : out;
}

async function applyScreenshotOverlay(
  session: SessionState,
  data: Record<string, unknown>,
  logPath: string,
): Promise<void> {
  const overlaySnapshotFlags = {
    snapshotInteractiveOnly: true,
    snapshotCompact: true,
  } satisfies CommandFlags;
  const overlaySnapshotData = await captureSnapshotData({
    device: session.device,
    session,
    flags: overlaySnapshotFlags,
    logPath,
    snapshotScope: undefined,
  });
  const overlaySnapshot = buildSnapshotState(overlaySnapshotData, overlaySnapshotFlags);
  setSessionSnapshot(session, overlaySnapshot);
  const overlayRefs = await annotateScreenshotWithRefs({
    screenshotPath: data.path as string,
    snapshot: overlaySnapshot,
  });
  data.overlayRefs = overlayRefs;
}

function recordVisualizationAndAction(params: {
  session: SessionState;
  sessionStore: SessionStore;
  command: string;
  resolvedPositionals: string[];
  recordedPositionals: string[];
  recordedFlags: Record<string, unknown>;
  data: Record<string, unknown> | void;
  actionStartedAt: number;
  actionFinishedAt: number;
  flags: Record<string, unknown>;
}): void {
  const {
    session,
    sessionStore,
    command,
    resolvedPositionals,
    recordedPositionals,
    recordedFlags,
    data,
    actionStartedAt,
    actionFinishedAt,
    flags,
  } = params;
  const visualizationData = augmentScrollVisualizationResult(
    session,
    command,
    resolvedPositionals,
    data as Record<string, unknown> | void,
  );
  recordTouchVisualizationEvent(
    session,
    command,
    resolvedPositionals,
    visualizationData as Record<string, unknown> | void,
    flags,
    actionStartedAt,
    actionFinishedAt,
  );
  sessionStore.recordAction(session, {
    command,
    positionals: recordedPositionals,
    flags: recordedFlags,
    result: data ?? {},
  });
}
