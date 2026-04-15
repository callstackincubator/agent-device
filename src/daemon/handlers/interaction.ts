import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { handleTouchInteractionCommands } from './interaction-touch.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { dispatchGetViaRuntime, dispatchIsViaRuntime } from '../selector-runtime.ts';

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
    case 'get':
      return await dispatchGetViaRuntime(params);
    case 'is':
      return await dispatchIsViaRuntime(params);
    default:
      return null;
  }
}
