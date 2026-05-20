import type { CommandFlags } from '../core/dispatch.ts';
import type { AndroidAdbExecutor } from '../platforms/android/adb-executor.ts';
import type { DaemonCommandContext } from './context.ts';
import { handleFindCommands } from './handlers/find.ts';
import { handleInteractionCommands } from './handlers/interaction.ts';
import { handleLeaseCommands } from './handlers/lease.ts';
import { handleReactNativeCommands } from './handlers/react-native.ts';
import { handleRecordTraceCommands } from './handlers/record-trace.ts';
import { handleSessionCommands } from './handlers/session.ts';
import { handleSnapshotCommands } from './handlers/snapshot.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import type { SessionStore } from './session-store.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';

export async function runRequestHandlerChain(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction?: (req: DaemonRequest) => Promise<DaemonResponse>;
  androidAdbExecutor?: AndroidAdbExecutor;
  contextFromFlags: (
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ) => DaemonCommandContext;
}): Promise<DaemonResponse | null> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    leaseRegistry,
    invoke,
    invokeReplayAction,
    androidAdbExecutor,
    contextFromFlags,
  } = params;

  const leaseResponse = await handleLeaseCommands({ req, leaseRegistry });
  if (leaseResponse) return leaseResponse;

  const sessionResponse = await handleSessionCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
    invokeReplayAction,
    androidAdbExecutor,
  });
  if (sessionResponse) return sessionResponse;

  const snapshotResponse = await handleSnapshotCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
  });
  if (snapshotResponse) return snapshotResponse;

  const reactNativeResponse = await handleReactNativeCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    contextFromFlags,
  });
  if (reactNativeResponse) return reactNativeResponse;

  const recordTraceResponse = await handleRecordTraceCommands({
    req,
    sessionName,
    sessionStore,
    logPath,
  });
  if (recordTraceResponse) return recordTraceResponse;

  const findResponse = await handleFindCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
  });
  if (findResponse) return findResponse;

  const interactionResponse = await handleInteractionCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    contextFromFlags,
  });
  if (interactionResponse) return interactionResponse;

  return null;
}
