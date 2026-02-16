import { dispatchCommand, type CommandFlags } from '../core/dispatch.ts';
import type { DeviceInfo } from '../utils/device.ts';
import { attachRefs, type RawSnapshotNode } from '../utils/snapshot.ts';
import { AppError } from '../utils/errors.ts';
import { contextFromFlags } from './context.ts';
import { normalizeType } from './snapshot-processing.ts';

export async function resolveIosAppStateFromSnapshots(
  device: DeviceInfo,
  logPath: string,
  traceLogPath: string | undefined,
  flags: CommandFlags | undefined,
  dispatch: typeof dispatchCommand = dispatchCommand,
): Promise<{ appName: string; appBundleId?: string; source: 'snapshot-xctest' }> {
  let xctestResult: { nodes?: RawSnapshotNode[] } | undefined;
  try {
    xctestResult = (await dispatch(device, 'snapshot', [], flags?.out, {
      ...contextFromFlags(
        logPath,
        {
          ...flags,
          snapshotDepth: 1,
          snapshotCompact: true,
        },
        undefined,
        traceLogPath,
      ),
    })) as { nodes?: RawSnapshotNode[] };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new AppError(
      'COMMAND_FAILED',
      'Unable to resolve iOS app state from XCTest snapshot.',
      { cause },
    );
  }

  const xcNode = extractAppNodeFromSnapshot(xctestResult);
  if (xcNode?.appName || xcNode?.appBundleId) {
    return {
      appName: xcNode.appName ?? xcNode.appBundleId ?? 'unknown',
      appBundleId: xcNode.appBundleId,
      source: 'snapshot-xctest',
    };
  }

  throw new AppError(
    'COMMAND_FAILED',
    'Unable to resolve iOS app state from XCTest snapshot (0 nodes or missing application node).',
  );
}

function extractAppNodeFromSnapshot(
  data: { nodes?: RawSnapshotNode[] } | undefined,
): { appName?: string; appBundleId?: string } | null {
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(rawNodes);
  const appNode = nodes.find((node) => normalizeType(node.type ?? '') === 'application') ?? nodes[0];
  if (!appNode) return null;
  const appName = appNode.label?.trim();
  const appBundleId = appNode.identifier?.trim();
  if (!appName && !appBundleId) return null;
  return { appName: appName || undefined, appBundleId: appBundleId || undefined };
}
