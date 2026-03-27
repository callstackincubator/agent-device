import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import type { CaptureSnapshotForSession } from './interaction-snapshot.ts';
import type { ResolveRefTarget } from './interaction-targeting.ts';
import type { RefSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { handlePressCommand } from './interaction-press.ts';
import { handleFillCommand } from './interaction-fill.ts';

export async function handleTouchInteractionCommands(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
    resolveRefTarget: ResolveRefTarget;
    refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
  },
): Promise<DaemonResponse | null> {
  switch (params.req.command) {
    case 'press':
    case 'click':
      return await handlePressCommand(params);
    case 'fill':
      return await handleFillCommand(params);
    default:
      return null;
  }
}
