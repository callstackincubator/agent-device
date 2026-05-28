import type { CommandFlags } from '../core/dispatch.ts';
import { DAEMON_COMMAND_GROUPS } from '../command-catalog.ts';
import type { AndroidAdbExecutor } from '../platforms/android/adb-executor.ts';
import { AppError } from '../utils/errors.ts';
import type { DaemonCommandContext } from './context.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import type { SessionStore } from './session-store.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';

const loadLeaseHandlerModule = lazyImport(() => import('./handlers/lease.ts'));
const loadSessionHandlerModule = lazyImport(() => import('./handlers/session.ts'));
const loadSnapshotHandlerModule = lazyImport(() => import('./handlers/snapshot.ts'));
const loadReactNativeHandlerModule = lazyImport(() => import('./handlers/react-native.ts'));
const loadRecordTraceHandlerModule = lazyImport(() => import('./handlers/record-trace.ts'));
const loadFindHandlerModule = lazyImport(() => import('./handlers/find.ts'));
const loadInteractionHandlerModule = lazyImport(() => import('./handlers/interaction.ts'));

type RequestHandlerChainParams = {
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
};

export async function runRequestHandlerChain(
  params: RequestHandlerChainParams,
): Promise<DaemonResponse | null> {
  const { command } = params.req;
  if (DAEMON_COMMAND_GROUPS.leaseHandler.has(command)) {
    return await runLeaseHandler(params);
  }
  if (DAEMON_COMMAND_GROUPS.sessionHandler.has(command)) {
    return await runSessionHandler(params);
  }
  if (DAEMON_COMMAND_GROUPS.snapshot.has(command)) {
    return await runSnapshotHandler(params);
  }
  if (DAEMON_COMMAND_GROUPS.reactNativeHandler.has(command)) {
    return await runReactNativeHandler(params);
  }
  if (DAEMON_COMMAND_GROUPS.recordTraceHandler.has(command)) {
    return await runRecordTraceHandler(params);
  }
  if (DAEMON_COMMAND_GROUPS.findHandler.has(command)) {
    return await runFindHandler(params);
  }
  if (DAEMON_COMMAND_GROUPS.interactionHandler.has(command)) {
    return await runInteractionHandler(params);
  }

  // Commands not claimed by a specialized family continue to generic platform dispatch.
  return null;
}

async function runLeaseHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleLeaseCommands } = await loadLeaseHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'lease',
    await handleLeaseCommands({ req: params.req, leaseRegistry: params.leaseRegistry }),
  );
}

async function runSessionHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleSessionCommands } = await loadSessionHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'session',
    await handleSessionCommands({
      req: params.req,
      sessionName: params.sessionName,
      logPath: params.logPath,
      sessionStore: params.sessionStore,
      invoke: params.invoke,
      invokeReplayAction: params.invokeReplayAction,
      androidAdbExecutor: params.androidAdbExecutor,
    }),
  );
}

async function runSnapshotHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleSnapshotCommands } = await loadSnapshotHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'snapshot',
    await handleSnapshotCommands({
      req: params.req,
      sessionName: params.sessionName,
      logPath: params.logPath,
      sessionStore: params.sessionStore,
    }),
  );
}

async function runReactNativeHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleReactNativeCommands } = await loadReactNativeHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'react-native',
    await handleReactNativeCommands({
      req: params.req,
      sessionName: params.sessionName,
      logPath: params.logPath,
      sessionStore: params.sessionStore,
      contextFromFlags: params.contextFromFlags,
    }),
  );
}

async function runRecordTraceHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleRecordTraceCommands } = await loadRecordTraceHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'record-trace',
    await handleRecordTraceCommands({
      req: params.req,
      sessionName: params.sessionName,
      sessionStore: params.sessionStore,
      logPath: params.logPath,
    }),
  );
}

async function runFindHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleFindCommands } = await loadFindHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'find',
    await handleFindCommands({
      req: params.req,
      sessionName: params.sessionName,
      logPath: params.logPath,
      sessionStore: params.sessionStore,
      invoke: params.invoke,
    }),
  );
}

async function runInteractionHandler(params: RequestHandlerChainParams): Promise<DaemonResponse> {
  const { handleInteractionCommands } = await loadInteractionHandlerModule();
  return expectHandlerResponse(
    params.req.command,
    'interaction',
    await handleInteractionCommands({
      req: params.req,
      sessionName: params.sessionName,
      logPath: params.logPath,
      sessionStore: params.sessionStore,
      contextFromFlags: params.contextFromFlags,
    }),
  );
}

function lazyImport<T>(load: () => Promise<T>): () => Promise<T> {
  let modulePromise: Promise<T> | undefined;
  return () => {
    modulePromise ??= load();
    return modulePromise;
  };
}

function expectHandlerResponse(
  command: string,
  handlerFamily: string,
  response: DaemonResponse | null,
): DaemonResponse {
  if (response) return response;
  throw new AppError(
    'INTERNAL_ERROR',
    `Daemon handler routing mismatch: ${handlerFamily} handler matched command "${command}" but returned no response.`,
  );
}
