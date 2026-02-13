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
): Promise<{ appName: string; appBundleId?: string; source: 'snapshot-ax' | 'snapshot-xctest' }> {
  if (device.kind === 'device') {
    const xctestResult = await dispatchCommand(device, 'snapshot', [], flags?.out, {
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
    const xcNode = extractAppNodeFromSnapshot(xctestResult as { nodes?: RawSnapshotNode[] });
    return {
      appName: xcNode?.appName ?? xcNode?.appBundleId ?? 'unknown',
      appBundleId: xcNode?.appBundleId,
      source: 'snapshot-xctest',
    };
  }

  const axResult = await dispatchCommand(device, 'snapshot', [], flags?.out, {
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
  const xctestResult = await dispatchCommand(device, 'snapshot', [], flags?.out, {
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
  const xcNode = extractAppNodeFromSnapshot(xctestResult as { nodes?: RawSnapshotNode[] });
  return {
    appName: xcNode?.appName ?? xcNode?.appBundleId ?? 'unknown',
    appBundleId: xcNode?.appBundleId,
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
