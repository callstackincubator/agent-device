import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { handleTouchInteractionCommands } from './interaction-touch.ts';
import { handleGetCommand } from './interaction-get.ts';
import { handleIsCommand } from './interaction-is.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { resolveRefTarget } from './interaction-targeting.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';

export { unsupportedRefSnapshotFlags } from './interaction-flags.ts';

export async function handleInteractionCommands(
  params: InteractionHandlerParams,
): Promise<DaemonResponse | null> {
  const touchResponse = await handleTouchInteractionCommands({
    ...params,
    captureSnapshotForSession,
    resolveRefTarget,
    refSnapshotFlagGuardResponse,
  });
  if (touchResponse) {
    return touchResponse;
  }

  switch (params.req.command) {
    case 'get':
      return await handleGetCommand(params);
    case 'is':
      return await handleIsCommand(params);
    default:
      return null;
  }
}
