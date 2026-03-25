import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import { extractNodeReadText } from '../snapshot-processing.ts';
import type { SessionState } from '../types.ts';
import type { SnapshotNode } from '../../utils/snapshot.ts';
import type { ContextFromFlags } from './interaction-common.ts';
import { resolveRectCenter } from './interaction-targeting.ts';

export async function readTextForNode(params: {
  device: SessionState['device'];
  node: SnapshotNode;
  flags: CommandFlags | undefined;
  appBundleId?: string;
  traceOutPath?: string;
  surface?: SessionState['surface'];
  contextFromFlags: ContextFromFlags;
  dispatch: typeof dispatchCommand;
}): Promise<string> {
  const { device, node, flags, appBundleId, traceOutPath, surface, contextFromFlags, dispatch } =
    params;
  const fallbackText = extractNodeReadText(node);
  const center = resolveRectCenter(node.rect);
  if (!center) {
    return fallbackText;
  }

  try {
    const rawData = await dispatch(
      device,
      'read',
      [String(center.x), String(center.y)],
      undefined,
      {
        ...contextFromFlags(flags, appBundleId, traceOutPath),
        surface,
      },
    );
    const data = rawData && typeof rawData === 'object' ? rawData : undefined;
    const text = typeof data?.text === 'string' ? data.text : '';
    return text.trim() ? text : fallbackText;
  } catch {
    return fallbackText;
  }
}
