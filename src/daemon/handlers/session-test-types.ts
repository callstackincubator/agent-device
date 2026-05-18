import type { DaemonResponse } from '../types.ts';
import type { ReplayScriptMetadata } from './session-replay-script.ts';

export type ReplayTestRunReplayParams = {
  filePath: string;
  sessionName: string;
  platform?: ReplayScriptMetadata['platform'];
  target?: ReplayScriptMetadata['target'];
  requestId?: string;
  artifactsDir?: string;
  artifactPaths?: Set<string>;
};

export type ReplayTestRunReplay = (params: ReplayTestRunReplayParams) => Promise<DaemonResponse>;

export type ReplayTestCleanupSession = (sessionName: string) => Promise<void>;

export type ReplayTestRuntimeDependencies = {
  runReplay: ReplayTestRunReplay;
  cleanupSession: ReplayTestCleanupSession;
};
