import type { CommandFlags } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { runReplayTestSuite } from './session-test.ts';
import { handleCloseCommand } from './session-close.ts';
import { collectReplayActionArtifactPaths, runReplayScriptFile } from './session-replay-runtime.ts';
import type { ReplayScriptMetadata } from './session-replay-script.ts';

export function buildNestedReplayFlags(params: {
  parentFlags: CommandFlags | undefined;
  platform: ReplayScriptMetadata['platform'] | undefined;
  artifactsDir: string | undefined;
}): CommandFlags | undefined {
  const { parentFlags, platform, artifactsDir } = params;
  if (platform === undefined && artifactsDir === undefined) return parentFlags;
  return {
    ...(parentFlags ?? {}),
    ...(platform !== undefined ? { platform } : {}),
    ...(artifactsDir !== undefined ? { artifactsDir } : {}),
  };
}

export async function handleSessionReplayCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore, invoke } = params;

  if (req.command === 'replay') {
    return await runReplayScriptFile({
      req,
      sessionName,
      logPath,
      sessionStore,
      invoke,
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
        artifactsDir,
        artifactPaths,
      }) => {
        const captureArtifacts = (response: DaemonResponse): DaemonResponse => {
          if (!artifactPaths) return response;
          collectReplayActionArtifactPaths(response).forEach((entry) => artifactPaths.add(entry));
          return response;
        };

        const nestedFlags = buildNestedReplayFlags({
          parentFlags: req.flags,
          platform,
          artifactsDir,
        });

        return await runReplayScriptFile({
          req: {
            ...req,
            command: 'replay',
            session: testSessionName,
            positionals: [filePath],
            flags: nestedFlags,
            meta: requestId ? { ...(req.meta ?? {}), requestId } : req.meta,
          },
          sessionName: testSessionName,
          logPath,
          sessionStore,
          invoke: async (nestedReq) => captureArtifacts(await invoke(nestedReq)),
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
        });
      },
    });
  }

  return null;
}
