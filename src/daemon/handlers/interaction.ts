import { dispatchCommand } from '../../core/dispatch.ts';
import type { DaemonResponse } from '../types.ts';
import { handleFillCommand } from './interaction-fill.ts';
import { handleGetCommand } from './interaction-get.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { handleIsCommand } from './interaction-is.ts';
import { handlePressCommand } from './interaction-press.ts';
import { handleScrollIntoViewCommand } from './interaction-scroll.ts';

export { unsupportedRefSnapshotFlags } from './interaction-flags.ts';

export async function handleInteractionCommands(
  params: Omit<InteractionHandlerParams, 'dispatch'> & {
    dispatch?: typeof dispatchCommand;
  },
): Promise<DaemonResponse | null> {
  const handlerParams: InteractionHandlerParams = {
    ...params,
    dispatch: params.dispatch ?? dispatchCommand,
  };

  switch (params.req.command) {
    case 'click':
    case 'press':
      return await handlePressCommand(handlerParams);
    case 'fill':
      return await handleFillCommand(handlerParams);
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
