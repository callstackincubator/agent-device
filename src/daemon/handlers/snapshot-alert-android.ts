import { dispatchCommand } from '../../core/dispatch.ts';
import { contextFromFlags } from '../context.ts';
import { AppError } from '../../utils/errors.ts';
import type { RawSnapshotNode } from '../../utils/snapshot.ts';
import { successText } from '../../utils/success-text.ts';
import { sleep } from '../../utils/timeouts.ts';
import {
  chooseAndroidAlertButton,
  findAndroidAlertCandidate,
  type AndroidAlertCandidate,
  type AndroidAlertInfo,
} from '../../platforms/android/alert-detection.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { recordIfSession } from './snapshot-session.ts';
import {
  ALERT_ACTION_RETRY_MS,
  DEFAULT_TIMEOUT_MS,
  parseTimeout,
  POLL_INTERVAL_MS,
} from './parse-utils.ts';
import { errorResponse } from './response.ts';
import type { SessionStore } from '../session-store.ts';

type AndroidAlertAction = 'get' | 'accept' | 'dismiss' | 'wait';

type HandleAndroidAlertCommandParams = {
  req: DaemonRequest;
  logPath: string;
  sessionStore: SessionStore;
  session: SessionState | undefined;
  device: SessionState['device'];
  action: string;
};

export async function handleAndroidAlertCommand(
  params: HandleAndroidAlertCommandParams,
): Promise<DaemonResponse> {
  const action = normalizeAndroidAlertAction(params.action);
  if (action === 'wait') {
    return await waitForAndroidAlert(params);
  }
  if (action === 'get') {
    const candidate = await readAndroidAlertCandidate(params);
    const data = buildAndroidAlertStatusResponse(candidate?.alert ?? null);
    recordIfSession(params.sessionStore, params.session, params.req, data);
    return { ok: true, data };
  }
  return await handleAndroidAlertAction(params, action);
}

async function waitForAndroidAlert(
  params: HandleAndroidAlertCommandParams,
): Promise<DaemonResponse> {
  const timeout = parseTimeout(params.req.positionals?.[1]) ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  const candidate = await pollAndroidAlertCandidate(params, timeout);
  if (candidate) {
    const data = {
      kind: 'alertWait',
      platform: 'android',
      action: 'wait',
      alert: candidate.alert,
      waitedMs: Date.now() - start,
      ...successText('Alert visible'),
    };
    recordIfSession(params.sessionStore, params.session, params.req, data);
    return { ok: true, data };
  }
  return errorResponse('COMMAND_FAILED', 'alert wait timed out');
}

async function handleAndroidAlertAction(
  params: HandleAndroidAlertCommandParams,
  action: 'accept' | 'dismiss',
): Promise<DaemonResponse> {
  const candidate = await pollAndroidAlertCandidate(params, ALERT_ACTION_RETRY_MS);
  if (!candidate) {
    throw new AppError('COMMAND_FAILED', 'alert not found', {
      hint: 'If a sheet is visible in snapshot but alert reports no alert, it is likely app-owned UI. Use snapshot -i and press the visible label/ref.',
    });
  }

  const button = chooseAndroidAlertButton(candidate.buttons, action);
  if (button) {
    await dispatchAndroidAlertCommand(params, 'press', [String(button.x), String(button.y)]);
    const data = buildAndroidAlertHandledResponse(action, candidate.alert, button.label);
    recordIfSession(params.sessionStore, params.session, params.req, data);
    return { ok: true, data };
  }

  if (action === 'dismiss') {
    await dispatchAndroidAlertCommand(params, 'back', []);
    const data = buildAndroidAlertHandledResponse(action, candidate.alert, 'Back');
    recordIfSession(params.sessionStore, params.session, params.req, data);
    return { ok: true, data };
  }

  throw new AppError('COMMAND_FAILED', 'alert accept found an alert but no accept button', {
    alert: candidate.alert,
    hint: 'Inspect alert get --json for visible buttons, then use press by visible label/ref if needed.',
  });
}

async function pollAndroidAlertCandidate(
  params: Pick<HandleAndroidAlertCommandParams, 'device' | 'logPath' | 'req' | 'session'>,
  timeoutMs: number,
): Promise<AndroidAlertCandidate | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const candidate = await readAndroidAlertCandidate(params);
    if (candidate) return candidate;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function readAndroidAlertCandidate(
  params: Pick<HandleAndroidAlertCommandParams, 'device' | 'logPath' | 'req' | 'session'>,
): Promise<AndroidAlertCandidate | null> {
  const result = (await dispatchAndroidAlertCommand(params, 'snapshot', [])) as {
    nodes?: RawSnapshotNode[];
  };
  return findAndroidAlertCandidate(result.nodes ?? []);
}

async function dispatchAndroidAlertCommand(
  params: Pick<HandleAndroidAlertCommandParams, 'device' | 'logPath' | 'req' | 'session'>,
  command: string,
  positionals: string[],
): Promise<Record<string, unknown> | void> {
  return await dispatchCommand(params.device, command, positionals, undefined, {
    ...contextFromFlags(
      params.logPath,
      { ...params.req.flags, snapshotInteractiveOnly: false },
      params.session?.appBundleId,
      params.session?.trace?.outPath,
    ),
  });
}

function normalizeAndroidAlertAction(action: string): AndroidAlertAction {
  if (action === 'accept' || action === 'dismiss' || action === 'wait') return action;
  return 'get';
}

function buildAndroidAlertStatusResponse(alert: AndroidAlertInfo | null): Record<string, unknown> {
  return {
    kind: 'alertStatus',
    platform: 'android',
    action: 'get',
    alert,
    ...(alert ? successText('Alert visible') : successText('No alert visible')),
  };
}

function buildAndroidAlertHandledResponse(
  action: 'accept' | 'dismiss',
  alert: AndroidAlertInfo,
  button: string,
): Record<string, unknown> {
  return {
    kind: 'alertHandled',
    platform: 'android',
    action,
    handled: true,
    alert,
    button,
    ...successText(`Alert ${action}ed`),
  };
}
