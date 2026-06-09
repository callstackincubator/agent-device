import type { DaemonResponse } from '../types.ts';
import type { ReplayScriptMetadata } from '../../replay/script.ts';
import type { ReplayTestShardContext } from './session-test-sharding.ts';

export type ReplayTestRunReplayParams = {
  filePath: string;
  sessionName: string;
  platform?: ReplayScriptMetadata['platform'];
  target?: ReplayScriptMetadata['target'];
  requestId?: string;
  artifactsDir?: string;
  artifactPaths?: Set<string>;
  tracePath?: string;
  shard?: ReplayTestShardContext;
};

export type ReplayTestRunReplay = (params: ReplayTestRunReplayParams) => Promise<DaemonResponse>;

export type ReplayTestCleanupSession = (sessionName: string) => Promise<void>;

export type ReplayTestFinalizeAttempt = (params: {
  sessionName: string;
  artifactPaths: Set<string>;
  artifactsDir?: string;
  tracePath?: string;
}) => Promise<DaemonResponse | undefined>;

export type ReplayTestRuntimeDependencies = {
  runReplay: ReplayTestRunReplay;
  cleanupSession: ReplayTestCleanupSession;
  finalizeAttempt?: ReplayTestFinalizeAttempt;
};
