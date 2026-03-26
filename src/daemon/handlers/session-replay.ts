import { dispatchCommand } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { stopIosRunnerSession } from '../../platforms/ios/runner-client.ts';
import { runMacOsAlertAction } from '../../platforms/ios/macos-helper.ts';
import { clearRuntimeHintsFromApp } from '../runtime-hints.ts';
import { settleIosSimulator } from './session-device-utils.ts';
import { runReplayTestSuite } from './session-test.ts';
import { handleCloseCommand } from './session-close.ts';
import { stopAppLog } from '../app-log.ts';
import { collectReplayActionArtifactPaths, runReplayScriptFile } from './session-replay-runtime.ts';

export async function handleSessionReplayCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  dispatch: typeof dispatchCommand;
  stopIosRunner?: typeof stopIosRunnerSession;
  dismissMacOsAlert?: typeof runMacOsAlertAction;
  clearRuntimeHints?: typeof clearRuntimeHintsFromApp;
  settleSimulator?: typeof settleIosSimulator;
  appLogOps?: {
    stop: typeof stopAppLog;
  };
}): Promise<DaemonResponse | null> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
    dispatch,
    stopIosRunner = stopIosRunnerSession,
    dismissMacOsAlert = runMacOsAlertAction,
    clearRuntimeHints = clearRuntimeHintsFromApp,
    settleSimulator = settleIosSimulator,
    appLogOps = {
      stop: stopAppLog,
    },
  } = params;

  if (req.command === 'replay') {
    return await runReplayScriptFile({
      req,
      sessionName,
      logPath,
      sessionStore,
      invoke,
      dispatch,
    });
  }

  if (req.command === 'test') {
    return await runReplayTestSuite({
      req,
      sessionName,
      runReplay: async ({
        filePath,
        sessionName: testSessionName,
        platform,
        requestId,
        artifactPaths,
      }) => {
        const captureArtifacts = (response: DaemonResponse): DaemonResponse => {
          if (!artifactPaths) return response;
          collectReplayActionArtifactPaths(response).forEach((entry) => artifactPaths.add(entry));
          return response;
        };

        return await runReplayScriptFile({
          req: {
            ...req,
            command: 'replay',
            session: testSessionName,
            positionals: [filePath],
            flags: platform === undefined ? req.flags : { ...(req.flags ?? {}), platform },
            meta: requestId ? { ...(req.meta ?? {}), requestId } : req.meta,
          },
          sessionName: testSessionName,
          logPath,
          sessionStore,
          invoke: async (nestedReq) => captureArtifacts(await invoke(nestedReq)),
          dispatch,
        });
      },
      cleanupSession: async (testSessionName) => {
        await cleanupReplayTestSession({
          req,
          sessionName: testSessionName,
          logPath,
          sessionStore,
          dispatch,
          stopIosRunner,
          dismissMacOsAlert,
          clearRuntimeHints,
          settleSimulator,
          appLogOps,
        });
      },
    });
  }

  return null;
}
async function cleanupReplayTestSession(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  dispatch: typeof dispatchCommand;
  stopIosRunner: typeof stopIosRunnerSession;
  dismissMacOsAlert: typeof runMacOsAlertAction;
  clearRuntimeHints: typeof clearRuntimeHintsFromApp;
  settleSimulator: typeof settleIosSimulator;
  appLogOps: {
    stop: typeof stopAppLog;
  };
}): Promise<void> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    dispatch,
    stopIosRunner,
    dismissMacOsAlert,
    clearRuntimeHints,
    settleSimulator,
    appLogOps,
  } = params;
  if (!sessionStore.get(sessionName)) return;

  await handleCloseCommand({
    req: {
      token: req.token,
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: {},
      meta: req.meta,
    },
    sessionName,
    logPath,
    sessionStore,
    dispatch,
    stopIosRunner,
    dismissMacOsAlert,
    clearRuntimeHints,
    settleSimulator,
    appLogOps,
  });
}
