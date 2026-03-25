import { dispatchCommand } from '../../core/dispatch.ts';
import type { DaemonResponse } from '../types.ts';
import { getAndroidScreenSize } from '../../platforms/android/index.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { handleTouchInteractionCommands } from './interaction-touch.ts';
import { handleGetCommand } from './interaction-get.ts';
import { handleIsCommand } from './interaction-is.ts';
import { handleScrollIntoViewCommand } from './interaction-scroll.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { resolveRefTarget } from './interaction-targeting.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';

export { unsupportedRefSnapshotFlags } from './interaction-flags.ts';

export async function handleInteractionCommands(
  params: Omit<InteractionHandlerParams, 'dispatch'> & {
    dispatch?: typeof dispatchCommand;
    readAndroidScreenSize?: typeof getAndroidScreenSize;
  },
): Promise<DaemonResponse | null> {
  const dispatch = params.dispatch ?? dispatchCommand;
  const readAndroidScreenSize = params.readAndroidScreenSize ?? getAndroidScreenSize;
  const handlerParams: InteractionHandlerParams = { ...params, dispatch };

  const touchResponse = await handleTouchInteractionCommands({
    ...handlerParams,
    readAndroidScreenSize,
    captureSnapshotForSession,
    resolveRefTarget,
    refSnapshotFlagGuardResponse,
  });
  if (touchResponse) {
    return touchResponse;
  }

  switch (params.req.command) {
    case 'get':
      return await handleGetCommand(handlerParams);
    case 'is':
      return await handleIsCommand(handlerParams);
    case 'scrollintoview':
      return await handleScrollIntoViewCommand(handlerParams);
    default:
      return null;
  }
}
