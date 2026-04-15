import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { handleTouchInteractionCommands } from './interaction-touch.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { dispatchGetViaRuntime, dispatchIsViaRuntime } from '../selector-runtime.ts';
import { createInteractionRuntime } from './interaction-runtime.ts';
import { finalizeTouchInteraction } from './interaction-common.ts';
import { errorResponse } from './response.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { normalizeError } from '../../utils/errors.ts';
import { successText } from '../../utils/success-text.ts';
import { recoverAndroidBlockingSystemDialog } from '../android-system-dialog.ts';

export { unsupportedRefSnapshotFlags } from './interaction-flags.ts';

export async function handleInteractionCommands(
  params: InteractionHandlerParams,
): Promise<DaemonResponse | null> {
  const touchResponse = await handleTouchInteractionCommands({
    ...params,
    captureSnapshotForSession,
    refSnapshotFlagGuardResponse,
  });
  if (touchResponse) {
    return touchResponse;
  }

  switch (params.req.command) {
    case 'type':
      return await dispatchTypeViaRuntime({
        ...params,
        captureSnapshotForSession,
      });
    case 'get':
      return await dispatchGetViaRuntime(params);
    case 'is':
      return await dispatchIsViaRuntime(params);
    default:
      return null;
  }
}

async function dispatchTypeViaRuntime(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: typeof captureSnapshotForSession;
  },
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');
  if (!isCommandSupportedOnDevice('type', session.device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'type is not supported on this device');
  }
  if (session.device.platform === 'android' && session.recording) {
    const androidRecoveryResult = await recoverAndroidBlockingSystemDialog({ session });
    if (androidRecoveryResult === 'failed') {
      return errorResponse('COMMAND_FAILED', 'Android system dialog blocked the recording session');
    }
  }

  const text = (req.positionals ?? []).join(' ');
  const runtime = createInteractionRuntime(params);
  const actionStartedAt = Date.now();
  try {
    const result = await runtime.interactions.typeText(text, {
      session: sessionName,
      requestId: req.meta?.requestId,
      delayMs: req.flags?.delayMs,
    });
    const actionFinishedAt = Date.now();
    const responseData = {
      ...(result.backendResult ?? {}),
      text: result.text,
      delayMs: result.delayMs,
      ...successText(result.message ?? `Typed ${Array.from(result.text).length} chars`),
    };
    return finalizeTouchInteraction({
      session,
      sessionStore,
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags,
      result: responseData,
      responseData,
      actionStartedAt,
      actionFinishedAt,
    });
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
