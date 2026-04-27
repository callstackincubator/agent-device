export const ANDROID_SNAPSHOT_MAX_NODES = 800;

export type AndroidSnapshotBackendMetadata = {
  backend: 'android-helper' | 'uiautomator-dump';
  helperVersion?: string;
  helperApiVersion?: string;
  fallbackReason?: string;
  installReason?: 'missing' | 'outdated' | 'forced' | 'current' | 'skipped';
  waitForIdleTimeoutMs?: number;
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  rootPresent?: boolean;
  captureMode?: 'interactive-windows' | 'active-window';
  windowCount?: number;
  nodeCount?: number;
  helperTruncated?: boolean;
  elapsedMs?: number;
};
