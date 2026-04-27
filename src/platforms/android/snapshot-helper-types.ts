import type { RawSnapshotNode } from '../../utils/snapshot.ts';
import type { AndroidSnapshotAnalysis } from './ui-hierarchy.ts';
import type { AndroidSnapshotBackendMetadata } from './snapshot-types.ts';

export const ANDROID_SNAPSHOT_HELPER_NAME = 'android-snapshot-helper';
export const ANDROID_SNAPSHOT_HELPER_PACKAGE = 'com.callstack.agentdevice.snapshothelper';
export const ANDROID_SNAPSHOT_HELPER_RUNNER =
  'com.callstack.agentdevice.snapshothelper/.SnapshotInstrumentation';
export const ANDROID_SNAPSHOT_HELPER_PROTOCOL = 'android-snapshot-helper-v1';
export const ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT = 'uiautomator-xml';
export const ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS = 500;
export const ANDROID_SNAPSHOT_HELPER_COMMAND_OVERHEAD_MS = 5_000;

export type AndroidAdbExecutor = (
  args: string[],
  options?: {
    allowFailure?: boolean;
    timeoutMs?: number;
  },
) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type AndroidSnapshotHelperManifest = {
  name: 'android-snapshot-helper';
  version: string;
  releaseTag?: string;
  assetName?: string;
  apkUrl: string | null;
  sha256: string;
  checksumName?: string;
  packageName: string;
  versionCode: number;
  instrumentationRunner: string;
  minSdk: number;
  targetSdk?: number;
  outputFormat: 'uiautomator-xml';
  statusProtocol: 'android-snapshot-helper-v1';
  installArgs: string[];
};

export type AndroidSnapshotHelperArtifact = {
  apkPath: string;
  manifest: AndroidSnapshotHelperManifest;
};

export type AndroidSnapshotHelperPreparedArtifact = AndroidSnapshotHelperArtifact & {
  cleanup?: () => Promise<void>;
};

export type AndroidSnapshotHelperInstallPolicy = 'missing-or-outdated' | 'always' | 'never';

export type AndroidSnapshotHelperInstallResult = {
  packageName: string;
  versionCode: number;
  installedVersionCode?: number;
  installed: boolean;
  reason: 'missing' | 'outdated' | 'forced' | 'current' | 'skipped';
};

export type AndroidSnapshotHelperCaptureOptions = {
  adb: AndroidAdbExecutor;
  packageName?: string;
  instrumentationRunner?: string;
  waitForIdleTimeoutMs?: number;
  timeoutMs?: number;
  commandTimeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
};

export type AndroidSnapshotHelperMetadata = {
  helperApiVersion?: string;
  outputFormat: 'uiautomator-xml';
  waitForIdleTimeoutMs?: number;
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  rootPresent?: boolean;
  captureMode?: 'interactive-windows' | 'active-window';
  windowCount?: number;
  nodeCount?: number;
  truncated?: boolean;
  elapsedMs?: number;
};

export type AndroidSnapshotHelperOutput = {
  xml: string;
  metadata: AndroidSnapshotHelperMetadata;
};

export type AndroidSnapshotHelperParsedSnapshot = {
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
  metadata: AndroidSnapshotHelperMetadata;
};

export type { AndroidSnapshotBackendMetadata };
