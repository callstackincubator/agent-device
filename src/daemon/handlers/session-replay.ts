import { dispatchCommand } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
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
        if (!sessionStore.get(testSessionName)) return;
        await handleCloseCommand({
          req: {
            token: req.token,
            session: testSessionName,
            command: 'close',
            positionals: [],
            flags: {},
            meta: req.meta,
          },
          sessionName: testSessionName,
          logPath,
          sessionStore,
          dispatch,
          appLogOps,
        });
      },
    });
  }

  return null;
}
