import { dispatchCommand } from '../../core/dispatch.ts';
import { runMacOsSnapshotAction } from '../../platforms/ios/macos-helper.ts';
import {
  attachRefs,
  findNodeByRef,
  normalizeRef,
  type RawSnapshotNode,
  type SnapshotState,
} from '../../utils/snapshot.ts';
import type { DaemonResponse, DaemonRequest, SessionState } from '../types.ts';
import { contextFromFlags } from '../context.ts';
import { pruneGroupNodes, resolveRefLabel } from '../snapshot-processing.ts';

type CaptureSnapshotParams = {
  dispatchSnapshotCommand: typeof dispatchCommand;
  device: SessionState['device'];
  session: SessionState | undefined;
  req: DaemonRequest;
  logPath: string;
  snapshotScope?: string;
};

export async function captureSnapshot(
  params: CaptureSnapshotParams,
): Promise<{ snapshot: SnapshotState }> {
  const { dispatchSnapshotCommand, device, session, req, logPath, snapshotScope } = params;
  if (device.platform === 'macos' && session?.surface && session.surface !== 'app') {
    const helperSnapshot = await runMacOsSnapshotAction(session.surface);
    return { snapshot: buildSnapshotState(helperSnapshot, req.flags?.snapshotRaw) };
  }
  const data = (await dispatchSnapshotCommand(device, 'snapshot', [], req.flags?.out, {
    ...contextFromFlags(
      logPath,
      { ...req.flags, snapshotScope },
      session?.appBundleId,
      session?.trace?.outPath,
    ),
  })) as {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android' | 'macos-helper';
  };
  return { snapshot: buildSnapshotState(data, req.flags?.snapshotRaw) };
}

export function buildSnapshotState(
  data: {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android' | 'macos-helper';
  },
  snapshotRaw: boolean | undefined,
): SnapshotState {
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  return {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
}

export function resolveSnapshotScope(
  snapshotScope: string | undefined,
  session: SessionState | undefined,
): { ok: true; scope?: string } | { ok: false; response: DaemonResponse } {
  if (!snapshotScope || !snapshotScope.trim().startsWith('@')) {
    return { ok: true, scope: snapshotScope };
  }
  if (!session?.snapshot) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'Ref scope requires an existing snapshot in session.',
        },
      },
    };
  }
  const ref = normalizeRef(snapshotScope.trim());
  if (!ref) {
    return {
      ok: false,
      response: {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `Invalid ref scope: ${snapshotScope}` },
      },
    };
  }
  const node = findNodeByRef(session.snapshot.nodes, ref);
  const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
  if (!resolved) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${snapshotScope} not found or has no label`,
        },
      },
    };
  }
  return { ok: true, scope: resolved };
}
