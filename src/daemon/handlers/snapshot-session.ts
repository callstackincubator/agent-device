import { resolveTargetDevice } from '../../core/dispatch.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import type { DaemonRequest, SessionState } from '../types.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { SessionStore } from '../session-store.ts';

export async function resolveSessionDevice(
  sessionStore: SessionStore,
  sessionName: string,
  flags: DaemonRequest['flags'],
) {
  const session = sessionStore.get(sessionName);
  const device = session?.device ?? (await resolveTargetDevice(flags ?? {}));
  if (!session) await ensureDeviceReady(device);
  return { session, device };
}

export async function withSessionlessRunnerCleanup<T>(
  session: SessionState | undefined,
  device: SessionState['device'],
  task: () => Promise<T>,
): Promise<T> {
  const shouldCleanupSessionlessIosRunner = !session && device.platform === 'ios';
  try {
    return await task();
  } finally {
    // Sessionless iOS commands intentionally stop the runner to avoid leaked xcodebuild processes.
    // For multi-command flows, keep an active session via `open` so the runner can be reused.
    if (shouldCleanupSessionlessIosRunner) {
      await stopIosRunnerSession(device.id);
    }
  }
}

export function recordIfSession(
  sessionStore: SessionStore,
  session: SessionState | undefined,
  req: DaemonRequest,
  result: Record<string, unknown>,
): void {
  if (!session) return;
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result,
  });
}

export function buildSnapshotSession(params: {
  session: SessionState | undefined;
  sessionName: string;
  device: SessionState['device'];
  snapshot: SessionState['snapshot'];
}): SessionState {
  const { session, sessionName, device, snapshot } = params;
  if (session) {
    return { ...session, snapshot };
  }
  return {
    name: sessionName,
    device,
    createdAt: Date.now(),
    appBundleId: session?.appBundleId,
    snapshot,
    actions: [],
  };
}
