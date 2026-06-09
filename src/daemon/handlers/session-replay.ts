import path from 'node:path';
import type { CommandFlags } from '../../core/dispatch.ts';
import { sleep } from '../../utils/timeouts.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { runReplayTestSuite } from './session-test.ts';
import { handleCloseCommand } from './session-close.ts';
import { handleRecordCommand } from './record-trace-recording.ts';
import { collectReplayActionArtifactPaths, runReplayScriptFile } from './session-replay-runtime.ts';
import type { ReplayScriptMetadata } from '../../replay/script.ts';
import { buildReplayTestShardFlags, type ReplayTestShardContext } from './session-test-sharding.ts';

const REPLAY_TEST_RECORDING_PREROLL_MS = 1_000;
const REPLAY_TEST_RECORDING_TAIL_MS = 3_000;

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

async function startReplayTestRecording(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  artifactsDir: string | undefined;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore, artifactsDir } = params;
  const outPath = artifactsDir
    ? path.join(artifactsDir, 'recording.mp4')
    : `./recording-${Date.now()}.mp4`;
  return await handleRecordCommand({
    req: {
      token: req.token,
      session: sessionName,
      command: 'record',
      positionals: ['start', outPath],
      flags: {},
      meta: req.meta,
    },
    sessionName,
    sessionStore,
    logPath,
  });
}

async function startReplayTestRecordingIfNeeded(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  artifactsDir: string | undefined;
}): Promise<DaemonResponse | undefined> {
  const { req, sessionName, logPath, sessionStore, artifactsDir } = params;
  if (req.flags?.recordVideo !== true) return undefined;
  const activeSession = sessionStore.get(sessionName);
  if (!activeSession || activeSession.recording) return undefined;
  const response = await startReplayTestRecording({
    req,
    sessionName,
    logPath,
    sessionStore,
    artifactsDir,
  });
  if (response.ok) {
    await sleep(REPLAY_TEST_RECORDING_PREROLL_MS);
  }
  return response;
}

async function stopReplayTestRecording(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;
  return await handleRecordCommand({
    req: {
      token: req.token,
      session: sessionName,
      command: 'record',
      positionals: ['stop'],
      flags: {},
      meta: req.meta,
    },
    sessionName,
    sessionStore,
    logPath,
  });
}

async function finalizeReplayTestRecording(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  artifactPaths: Set<string>;
}): Promise<DaemonResponse | undefined> {
  const { req, sessionName, logPath, sessionStore, artifactPaths } = params;
  if (req.flags?.recordVideo !== true) return undefined;
  if (!sessionStore.get(sessionName)?.recording) return undefined;
  await sleep(REPLAY_TEST_RECORDING_TAIL_MS);
  const response = await stopReplayTestRecording({
    req,
    sessionName,
    logPath,
    sessionStore,
  });
  collectReplayActionArtifactPaths(response).forEach((entry) => artifactPaths.add(entry));
  return response;
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

        const startRecording = async (): Promise<DaemonResponse | undefined> =>
          await startReplayTestRecordingIfNeeded({
            req,
            sessionName: testSessionName,
            logPath,
            sessionStore,
            artifactsDir,
          });
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
              beforeOpenDispatch: async () => await startRecording(),
            },
          },
          sessionName: testSessionName,
          logPath,
          sessionStore,
          tracePath,
          invoke: async (nestedReq) => {
            const startResponse = await startRecording();
            if (startResponse && !startResponse.ok) return startResponse;
            const response = captureArtifacts(await invoke(nestedReq));
            return response;
          },
        });
        return replayResponse;
      },
      finalizeAttempt: async ({ sessionName: testSessionName, artifactPaths }) =>
        await finalizeReplayTestRecording({
          req,
          sessionName: testSessionName,
          logPath,
          sessionStore,
          artifactPaths,
        }),
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
