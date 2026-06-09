import type { CommandFlags } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { runReplayTestSuite } from './session-test.ts';
import { handleCloseCommand } from './session-close.ts';
import { collectReplayActionArtifactPaths, runReplayScriptFile } from './session-replay-runtime.ts';
import type { ReplayScriptMetadata } from '../../replay/script.ts';
import { buildReplayTestShardFlags, type ReplayTestShardContext } from './session-test-sharding.ts';
import {
  createReplayTestVideoRecording,
  type ReplayTestVideoRecording,
} from './session-replay-video-recording.ts';

export function buildNestedReplayFlags(params: {
  parentFlags: CommandFlags | undefined;
  platform: ReplayScriptMetadata['platform'] | undefined;
  target: ReplayScriptMetadata['target'] | undefined;
  artifactsDir: string | undefined;
  shard?: ReplayTestShardContext;
}): CommandFlags | undefined {
  const { platform, target, artifactsDir, shard } = params;
  const parentFlags = stripReplayTestHarnessFlags(params.parentFlags);
  if (
    platform === undefined &&
    target === undefined &&
    artifactsDir === undefined &&
    shard === undefined
  ) {
    return parentFlags;
  }
  return buildReplayTestShardFlags(
    {
      ...(parentFlags ?? {}),
      ...(platform !== undefined ? { platform } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(artifactsDir !== undefined ? { artifactsDir } : {}),
    },
    shard,
  );
}

function stripReplayTestHarnessFlags(flags: CommandFlags | undefined): CommandFlags | undefined {
  if (flags?.recordVideo !== true) return flags;
  const nestedFlags = { ...flags };
  delete nestedFlags.recordVideo;
  return Object.keys(nestedFlags).length > 0 ? nestedFlags : undefined;
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
    const videoRecordings = new Map<string, ReplayTestVideoRecording>();
    return await runReplayTestSuite({
      req,
      sessionName,
      runReplay: async ({
        filePath,
        sessionName: testSessionName,
        platform,
        target,
        requestId,
        artifactsDir,
        artifactPaths,
        tracePath,
        shard,
      }) => {
        const captureArtifacts = (response: DaemonResponse): DaemonResponse => {
          if (!artifactPaths) return response;
          collectReplayActionArtifactPaths(response).forEach((entry) => artifactPaths.add(entry));
          return response;
        };

        const nestedFlags = buildNestedReplayFlags({
          parentFlags: req.flags,
          platform,
          target,
          artifactsDir,
          shard,
        });

        const videoRecording = createReplayTestVideoRecording({
          req,
          sessionName: testSessionName,
          logPath,
          sessionStore,
          artifactsDir,
          tracePath,
        });
        videoRecordings.set(testSessionName, videoRecording);
        const replayResponse = await runReplayScriptFile({
          req: {
            ...req,
            command: 'replay',
            session: testSessionName,
            positionals: [filePath],
            flags: nestedFlags,
            meta: {
              ...(req.meta ?? {}),
              ...(requestId ? { requestId } : {}),
            },
            internal: {
              ...(req.internal ?? {}),
              openLifecycle: videoRecording.openLifecycle,
            },
          },
          sessionName: testSessionName,
          logPath,
          sessionStore,
          tracePath,
          invoke: async (nestedReq) => {
            const startResponse = await videoRecording.startIfReady();
            if (startResponse && !startResponse.ok) return startResponse;
            const response = captureArtifacts(await invoke(nestedReq));
            return response;
          },
        });
        return replayResponse;
      },
      finalizeAttempt: async ({ sessionName: testSessionName, artifactPaths }) =>
        await videoRecordings.get(testSessionName)?.finalize(artifactPaths),
      cleanupSession: async (testSessionName) => {
        videoRecordings.delete(testSessionName);
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
