import { normalizeError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { runMacOsAlertAction } from '../../platforms/ios/macos-helper.ts';
import { dispatchCommand } from '../../core/dispatch.ts';
import { contextFromFlags } from '../context.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { stopAppLog } from '../app-log.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { shutdownSimulator } from '../../platforms/ios/simulator.ts';
import { clearRuntimeHintsFromApp, hasRuntimeTransportHints } from '../runtime-hints.ts';
import { cleanupRetainedMaterializedPathsForSession } from '../materialized-path-registry.ts';
import { successText, withSuccessText } from '../../utils/success-text.ts';
import {
  IOS_SIMULATOR_POST_CLOSE_SETTLE_MS,
  isAndroidEmulator,
  isIosSimulator,
  settleIosSimulator,
} from './session-device-utils.ts';

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
}): Promise<SessionShutdownResult | undefined> {
  const { device, shutdownRequested } = params;
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

async function stopAppleRunnerForClose(session: SessionState): Promise<void> {
  await stopIosRunnerSession(session.device.id);
  if (session.device.platform !== 'macos') {
    return;
  }

  const dismissOptions =
    session.surface === 'frontmost-app'
      ? { surface: 'frontmost-app' as const }
      : session.appBundleId
        ? { bundleId: session.appBundleId }
        : {};
  await runMacOsAlertAction('dismiss', dismissOptions).catch((error) => {
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
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
  } = params;
  const session = sessionStore.get(sessionName);
  if (!session) {
    return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
  }
  if (session.appLog) {
    await stopAppLog(session.appLog);
  }
  if (req.positionals && req.positionals.length > 0) {
    if (session.device.platform === 'ios' || session.device.platform === 'macos') {
      await stopAppleRunnerForClose(session);
    }
    await dispatchCommand(session.device, 'close', req.positionals, req.flags?.out, {
      ...contextFromFlags(logPath, req.flags, session.appBundleId, session.trace?.outPath),
    });
    await settleIosSimulator(session.device, IOS_SIMULATOR_POST_CLOSE_SETTLE_MS);
  }
  if (session.device.platform === 'ios' || session.device.platform === 'macos') {
    // The targeted close path stops before dispatch to avoid runner/app races.
    // Stop again here so both plain and targeted closes end with the runner down.
    // macOS may no-op the second alert dismiss, but it keeps teardown symmetric with runner stop.
    await stopAppleRunnerForClose(session);
  }
  const runtime = sessionStore.getRuntimeHints(sessionName);
  if (hasRuntimeTransportHints(runtime) && session.appBundleId) {
    await clearRuntimeHintsFromApp({
      device: session.device,
      appId: session.appBundleId,
    }).catch(() => {});
  }
  sessionStore.recordAction(session, {
    command: 'close',
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: { session: sessionName, ...successText(`Closed: ${sessionName}`) },
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
  });
  if (shutdownResult) {
    return {
      ok: true,
      data: withSuccessText(
        { session: sessionName, shutdown: shutdownResult },
        `Closed: ${sessionName}`,
      ),
    };
  }
  return { ok: true, data: { session: sessionName, ...successText(`Closed: ${sessionName}`) } };
}
