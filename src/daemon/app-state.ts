import { dispatchCommand, type CommandFlags } from '../core/dispatch.ts';
import type { DeviceInfo } from '../utils/device.ts';
import { attachRefs, type RawSnapshotNode } from '../utils/snapshot.ts';
import { contextFromFlags } from './context.ts';
import { normalizeType } from './snapshot-processing.ts';

export async function resolveIosAppStateFromSnapshots(
  device: DeviceInfo,
  logPath: string,
  traceLogPath: string | undefined,
  flags: CommandFlags | undefined,
  dispatch: typeof dispatchCommand = dispatchCommand,
): Promise<{ appName: string; appBundleId?: string; source: 'snapshot-ax' | 'snapshot-xctest' }> {
  let xctestError: unknown = undefined;
  let xcNode: { appName?: string; appBundleId?: string } | null = null;
  try {
    const xctestResult = await dispatch(device, 'snapshot', [], flags?.out, {
      ...contextFromFlags(
        logPath,
        {
          ...flags,
          snapshotDepth: 1,
          snapshotCompact: true,
          snapshotBackend: 'xctest',
        },
        undefined,
        traceLogPath,
      ),
    });
    xcNode = extractAppNodeFromSnapshot(xctestResult as { nodes?: RawSnapshotNode[] });
    if (xcNode?.appName || xcNode?.appBundleId) {
      return {
        appName: xcNode.appName ?? xcNode.appBundleId ?? 'unknown',
        appBundleId: xcNode.appBundleId,
        source: 'snapshot-xctest',
      };
    }
  } catch (error) {
    xctestError = error;
    if (device.kind === 'device') {
      throw error;
    }
  }

  if (device.kind === 'device') {
    return {
      appName: 'unknown',
      appBundleId: undefined,
      source: 'snapshot-xctest',
    };
  }

  const axResult = await dispatch(device, 'snapshot', [], flags?.out, {
    ...contextFromFlags(
      logPath,
      {
        ...flags,
        snapshotDepth: 1,
        snapshotCompact: true,
        snapshotBackend: 'ax',
      },
      undefined,
      traceLogPath,
    ),
  });
  const axNode = extractAppNodeFromSnapshot(axResult as { nodes?: RawSnapshotNode[] });
  if (axNode?.appName || axNode?.appBundleId) {
    return {
      appName: axNode.appName ?? axNode.appBundleId ?? 'unknown',
      appBundleId: axNode.appBundleId,
      source: 'snapshot-ax',
    };
  }

  if (xctestError) {
    throw xctestError;
  }

  return {
    appName: 'unknown',
    appBundleId: undefined,
    source: 'snapshot-xctest',
  };
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
