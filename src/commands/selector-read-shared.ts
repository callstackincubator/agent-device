import type { AgentDeviceRuntime, CommandContext, CommandSessionRecord } from '../runtime-contract.ts';
import { AppError } from '../utils/errors.ts';
import type { SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { findNodeByRef, normalizeRef } from '../utils/snapshot.ts';
import { extractReadableText } from '../utils/text-surface.ts';
import { findNodeByLabel, now, toBackendContext } from './selector-read-utils.ts';

export type CapturedSnapshot = {
  sessionName: string;
  session?: CommandSessionRecord;
  snapshot: SnapshotState;
};

export type SelectorSnapshotOptions = {
  depth?: number;
  scope?: string;
  raw?: boolean;
};

export async function requireSnapshotSession(
  runtime: AgentDeviceRuntime,
  requestedName: string | undefined,
): Promise<CapturedSnapshot> {
  const sessionName = requestedName ?? 'default';
  const session = await runtime.sessions.get(sessionName);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'No active session. Run open first.');
  if (!session.snapshot) {
    throw new AppError('INVALID_ARGS', 'No snapshot in session. Run snapshot first.');
  }
  return { sessionName, session, snapshot: session.snapshot };
}

export async function captureSelectorSnapshot(
  runtime: AgentDeviceRuntime,
  options: CommandContext & SelectorSnapshotOptions,
  captureOptions: { updateSession: boolean; scope?: string } = { updateSession: true },
): Promise<CapturedSnapshot> {
  if (!runtime.backend.captureSnapshot) {
    throw new AppError('UNSUPPORTED_OPERATION', 'snapshot is not supported by this backend');
  }
  const sessionName = options.session ?? 'default';
  const session = await runtime.sessions.get(sessionName);
  const result = await runtime.backend.captureSnapshot(toBackendContext(runtime, options), {
    interactiveOnly: false,
    compact: false,
    depth: options.depth,
    scope: captureOptions.scope ?? options.scope,
    raw: options.raw,
  });
  const snapshot =
    result.snapshot ??
    ({
      nodes: result.nodes ?? [],
      truncated: result.truncated,
      backend: result.backend as SnapshotState['backend'],
      createdAt: now(runtime),
    } satisfies SnapshotState);
  if (captureOptions.updateSession && session) {
    await runtime.sessions.set({ ...session, snapshot });
  }
  return { sessionName, session, snapshot };
}

export async function readText(
  runtime: AgentDeviceRuntime,
  capture: CapturedSnapshot,
  node: SnapshotNode,
): Promise<string> {
  if (runtime.backend.readText) {
    const result = await runtime.backend.readText(
      toBackendContext(runtime, {
        session: capture.sessionName,
      }),
      node,
    );
    if (result.text.trim()) return result.text;
  }
  return extractReadableText(node);
}

export function resolveRefNode(
  nodes: SnapshotState['nodes'],
  refInput: string,
  options: {
    fallbackLabel: string;
    invalidRefMessage: string;
    notFoundMessage: string;
  },
): { ref: string; node: SnapshotNode } {
  const ref = normalizeRef(refInput);
  if (!ref) throw new AppError('INVALID_ARGS', options.invalidRefMessage);
  const node =
    findNodeByRef(nodes, ref) ??
    (options.fallbackLabel.length > 0 ? findNodeByLabel(nodes, options.fallbackLabel) : null);
  if (!node) throw new AppError('COMMAND_FAILED', options.notFoundMessage);
  return { ref, node };
}
