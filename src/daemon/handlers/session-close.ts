import { normalizeError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { runMacOsAlertAction } from '../../platforms/ios/macos-helper.ts';
import { contextFromFlags } from '../context.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { shutdownSimulator } from '../../platforms/ios/simulator.ts';
import { clearRuntimeHintsFromApp, hasRuntimeTransportHints } from '../runtime-hints.ts';
import { cleanupRetainedMaterializedPathsForSession } from '../materialized-path-registry.ts';
import {
  IOS_SIMULATOR_POST_CLOSE_SETTLE_MS,
  isAndroidEmulator,
  isIosSimulator,
  settleIosSimulator,
} from './session-device-utils.ts';

type AppLogStream = NonNullable<SessionState['appLog']>;

async function shutdownAndroidEmulator(device: DeviceInfo): Promise<{
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const result = await runCmd('adb', ['-s', device.id, 'emu', 'kill'], {
    allowFailure: true,
    timeoutMs: 15_000,
  });
  return {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

export type ShutdownAndroidEmulatorFn = typeof shutdownAndroidEmulator;

type SessionShutdownResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: ReturnType<typeof normalizeError>;
};

async function maybeShutdownSessionTarget(params: {
  device: DeviceInfo;
  shutdownRequested: boolean | undefined;
  shutdownSimulator: typeof shutdownSimulator;
  shutdownAndroidEmulator: typeof shutdownAndroidEmulator;
}): Promise<SessionShutdownResult | undefined> {
  const { device, shutdownRequested, shutdownSimulator, shutdownAndroidEmulator } = params;
  if (!shutdownRequested) return undefined;
  if (!isIosSimulator(device) && !isAndroidEmulator(device)) return undefined;
  try {
    return isIosSimulator(device)
      ? await shutdownSimulator(device)
      : await shutdownAndroidEmulator(device);
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      success: false,
      exitCode: -1,
      stdout: '',
      stderr: normalized.message,
      error: normalized,
    };
  }
}

async function stopAppleRunnerForClose(params: {
  session: SessionState;
  stopIosRunner: typeof stopIosRunnerSession;
  dismissMacOsAlert: typeof runMacOsAlertAction;
}): Promise<void> {
  const { session, stopIosRunner, dismissMacOsAlert } = params;
  await stopIosRunner(session.device.id);
  if (session.device.platform !== 'macos') {
    return;
  }

  const dismissOptions =
    session.surface === 'frontmost-app'
      ? { surface: 'frontmost-app' as const }
      : session.appBundleId
        ? { bundleId: session.appBundleId }
        : {};
  await dismissMacOsAlert('dismiss', dismissOptions).catch((error) => {
    emitDiagnostic({
      level: 'debug',
      phase: 'macos_close_alert_dismiss_failed',
      data: {
        session: session.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  });
}

export async function handleCloseCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatch: (
    device: DeviceInfo,
    command: string,
    positionals: string[],
    out?: string,
    context?: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | void>;
  stopIosRunner?: typeof stopIosRunnerSession;
  dismissMacOsAlert?: typeof runMacOsAlertAction;
  clearRuntimeHints?: typeof clearRuntimeHintsFromApp;
  settleSimulator?: typeof settleIosSimulator;
  shutdownSimulator?: typeof shutdownSimulator;
  shutdownAndroidEmulator?: ShutdownAndroidEmulatorFn;
  appLogOps: {
    stop: (stream: AppLogStream) => Promise<void>;
  };
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    dispatch,
    stopIosRunner = stopIosRunnerSession,
    dismissMacOsAlert = runMacOsAlertAction,
    clearRuntimeHints = clearRuntimeHintsFromApp,
    settleSimulator = settleIosSimulator,
    shutdownSimulator: shutdownSimulatorFn = shutdownSimulator,
    shutdownAndroidEmulator: shutdownAndroidEmulatorFn = shutdownAndroidEmulator,
    appLogOps,
  } = params;
  const session = sessionStore.get(sessionName);
  if (!session) {
    return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
  }
  if (session.appLog) {
    await appLogOps.stop(session.appLog);
  }
  if (req.positionals && req.positionals.length > 0) {
    if (session.device.platform === 'ios' || session.device.platform === 'macos') {
      await stopAppleRunnerForClose({ session, stopIosRunner, dismissMacOsAlert });
    }
    await dispatch(session.device, 'close', req.positionals, req.flags?.out, {
      ...contextFromFlags(logPath, req.flags, session.appBundleId, session.trace?.outPath),
    });
    await settleSimulator(session.device, IOS_SIMULATOR_POST_CLOSE_SETTLE_MS);
  }
  if (session.device.platform === 'ios' || session.device.platform === 'macos') {
    // The targeted close path stops before dispatch to avoid runner/app races.
    // Stop again here so both plain and targeted closes end with the runner down.
    // macOS may no-op the second alert dismiss, but it keeps teardown symmetric with runner stop.
    await stopAppleRunnerForClose({ session, stopIosRunner, dismissMacOsAlert });
  }
  const runtime = sessionStore.getRuntimeHints(sessionName);
  if (hasRuntimeTransportHints(runtime) && session.appBundleId) {
    await clearRuntimeHints({
      device: session.device,
      appId: session.appBundleId,
    }).catch(() => {});
  }
  sessionStore.recordAction(session, {
    command: 'close',
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: { session: sessionName, message: `Closed: ${sessionName}` },
  });
  if (req.flags?.saveScript) {
    session.recordSession = true;
  }
  sessionStore.writeSessionLog(session);
  await cleanupRetainedMaterializedPathsForSession(sessionName).catch(() => {});
  sessionStore.delete(sessionName);
  const shutdownResult = await maybeShutdownSessionTarget({
    device: session.device,
    shutdownRequested: req.flags?.shutdown,
    shutdownSimulator: shutdownSimulatorFn,
    shutdownAndroidEmulator: shutdownAndroidEmulatorFn,
  });
  if (shutdownResult) {
    return {
      ok: true,
      data: { session: sessionName, shutdown: shutdownResult, message: `Closed: ${sessionName}` },
    };
  }
  return { ok: true, data: { session: sessionName, message: `Closed: ${sessionName}` } };
}
