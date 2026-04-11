import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import { runMacOsAlertAction } from '../../platforms/ios/macos-helper.ts';
import { AppError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { recordIfSession } from './snapshot-session.ts';
import { DEFAULT_TIMEOUT_MS, parseTimeout, POLL_INTERVAL_MS } from './parse-utils.ts';
import { errorResponse } from './response.ts';

type HandleAlertCommandParams = {
  req: DaemonRequest;
  logPath: string;
  sessionStore: SessionStore;
  session: SessionState | undefined;
  device: SessionState['device'];
};

const ALERT_FALLBACK_HINT =
  'If the permission sheet is visible in snapshot or screenshot but alert reports no alert, take a scoped snapshot around the visible button label and use press @ref.';

export async function handleAlertCommand(
  params: HandleAlertCommandParams,
): Promise<DaemonResponse> {
  const { req, logPath, sessionStore, session, device } = params;
  const action = (req.positionals?.[0] ?? 'get').toLowerCase();
  const macOsAlertTarget = (() => {
    if (!session) return {};
    if (session.surface === 'frontmost-app') {
      return { surface: 'frontmost-app' as const };
    }
    return {
      bundleId: session.appBundleId,
      surface: session.surface,
    };
  })();
  if (!isCommandSupportedOnDevice('alert', device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'alert is not supported on this device');
  }
  if (device.platform === 'macos') {
    const runMacOsAlert = async () =>
      await runMacOsAlertAction(
        action === 'wait' ? 'get' : (action as 'get' | 'accept' | 'dismiss'),
        macOsAlertTarget,
      );
    if (action === 'wait') {
      const timeout = parseTimeout(req.positionals?.[1]) ?? DEFAULT_TIMEOUT_MS;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const data = await runMacOsAlert();
          recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
          return { ok: true, data };
        } catch {
          // keep waiting
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      return errorResponse('COMMAND_FAILED', 'alert wait timed out');
    }
    const resolvedAction = action === 'accept' || action === 'dismiss' ? action : 'get';
    if (resolvedAction === 'accept' || resolvedAction === 'dismiss') {
      const ALERT_ACTION_RETRY_MS = 2_000;
      const start = Date.now();
      let lastError: unknown;
      while (Date.now() - start < ALERT_ACTION_RETRY_MS) {
        try {
          const data = await runMacOsAlertAction(resolvedAction, macOsAlertTarget);
          recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
          return { ok: true, data };
        } catch (err) {
          lastError = err;
          const msg = String((err as { message?: unknown })?.message ?? '').toLowerCase();
          if (!msg.includes('alert not found') && !msg.includes('no alert')) break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      throw withAlertFallbackHint(lastError);
    }
    const data = await runMacOsAlertAction('get', macOsAlertTarget);
    recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
    return { ok: true, data };
  }
  if (action === 'wait') {
    const timeout = parseTimeout(req.positionals?.[1]) ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const data = await runIosRunnerCommand(
          device,
          { command: 'alert', action: 'get', appBundleId: session?.appBundleId },
          {
            verbose: req.flags?.verbose,
            logPath,
            traceLogPath: session?.trace?.outPath,
            requestId: req.meta?.requestId,
          },
        );
        recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
        return { ok: true, data };
      } catch {
        // keep waiting
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return errorResponse('COMMAND_FAILED', 'alert wait timed out');
  }

  const resolvedAction =
    action === 'accept' || action === 'dismiss' ? (action as 'accept' | 'dismiss') : 'get';
  const runnerOptions = {
    verbose: req.flags?.verbose,
    logPath,
    traceLogPath: session?.trace?.outPath,
    requestId: req.meta?.requestId,
  };
  if (resolvedAction === 'accept' || resolvedAction === 'dismiss') {
    const ALERT_ACTION_RETRY_MS = 2_000;
    const start = Date.now();
    let lastError: unknown;
    while (Date.now() - start < ALERT_ACTION_RETRY_MS) {
      try {
        const data = await runIosRunnerCommand(
          device,
          { command: 'alert', action: resolvedAction, appBundleId: session?.appBundleId },
          runnerOptions,
        );
        recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
        return { ok: true, data };
      } catch (err) {
        lastError = err;
        const msg = String((err as { message?: unknown })?.message ?? '').toLowerCase();
        if (!msg.includes('alert not found') && !msg.includes('no alert')) break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    // lastError is always set because ALERT_ACTION_RETRY_MS > 0
    throw withAlertFallbackHint(lastError);
  }

  const data = await runIosRunnerCommand(
    device,
    { command: 'alert', action: resolvedAction, appBundleId: session?.appBundleId },
    runnerOptions,
  );
  recordIfSession(sessionStore, session, req, data as Record<string, unknown>);
  return { ok: true, data };
}

function withAlertFallbackHint(error: unknown): unknown {
  if (!(error instanceof AppError)) {
    return error;
  }
  const message = String(error.message ?? '').toLowerCase();
  if (!message.includes('alert not found') && !message.includes('no alert')) {
    return error;
  }
  return new AppError(error.code, error.message, {
    ...(error.details ?? {}),
    hint: ALERT_FALLBACK_HINT,
  });
}
