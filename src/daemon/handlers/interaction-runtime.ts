import { dispatchCommand } from '../../core/dispatch.ts';
import type {
  AgentDeviceBackend,
  BackendActionResult,
  BackendSnapshotResult,
} from '../../backend.ts';
import { createAgentDevice, localCommandPolicy } from '../../runtime.ts';
import { AppError } from '../../utils/errors.ts';
import type { SessionState } from '../types.ts';
import { createUnsupportedArtifactAdapter } from '../runtime-artifacts.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import type { CaptureSnapshotForSession } from './interaction-snapshot.ts';

export function createInteractionRuntime(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
  },
) {
  const session = params.sessionStore.get(params.sessionName);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'No active session. Run open first.');
  return createAgentDevice({
    backend: createInteractionBackend({ ...params, session }),
    artifacts: createUnsupportedArtifactAdapter('interaction commands', { plural: true }),
    sessions: {
      get: (name) =>
        name === params.sessionName
          ? {
              name: params.sessionName,
              appBundleId: session.appBundleId,
              appName: session.appName,
              snapshot: session.snapshot,
              metadata: { surface: session.surface },
            }
          : undefined,
      set: (record) => {
        if (!record.snapshot) return;
        session.snapshot = record.snapshot;
        params.sessionStore.set(params.sessionName, session);
      },
    },
    policy: localCommandPolicy(),
  });
}

function createInteractionBackend(
  params: InteractionHandlerParams & { session: SessionState } & {
    captureSnapshotForSession: CaptureSnapshotForSession;
  },
): AgentDeviceBackend {
  const { req, session } = params;
  return {
    platform: session.device.platform,
    captureSnapshot: async (_context, options): Promise<BackendSnapshotResult> => ({
      snapshot: await params.captureSnapshotForSession(
        session,
        req.flags,
        params.sessionStore,
        params.contextFromFlags,
        { interactiveOnly: options?.interactiveOnly === true },
      ),
    }),
    tap: async (_context, point): Promise<BackendActionResult> =>
      toBackendActionResult(
        await dispatchCommand(
          session.device,
          'press',
          [String(point.x), String(point.y)],
          req.flags?.out,
          params.contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
        ),
      ),
    fill: async (_context, point, text): Promise<BackendActionResult> =>
      toBackendActionResult(
        await dispatchCommand(
          session.device,
          'fill',
          [String(point.x), String(point.y), text],
          req.flags?.out,
          params.contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
        ),
      ),
    typeText: async (_context, text): Promise<BackendActionResult> =>
      toBackendActionResult(
        await dispatchCommand(
          session.device,
          'type',
          [text],
          req.flags?.out,
          params.contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
        ),
      ),
  };
}

function toBackendActionResult(data: unknown): BackendActionResult {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
}
