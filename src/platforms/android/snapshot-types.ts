import type {
  AndroidSnapshotCaptureMode,
  AndroidSnapshotHelperInstallReason,
  AndroidSnapshotHelperTransport,
} from './snapshot-helper-types.ts';

export type AndroidSnapshotBackendMetadata = {
  backend: 'android-helper' | 'uiautomator-dump';
  helperVersion?: string;
  helperApiVersion?: string;
  helperTransport?: AndroidSnapshotHelperTransport;
  helperSessionReused?: boolean;
  fallbackReason?: string;
  installReason?: AndroidSnapshotHelperInstallReason;
  waitForIdleTimeoutMs?: number;
  waitForIdleQuietMs?: number;
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  rootPresent?: boolean;
  captureMode?: AndroidSnapshotCaptureMode;
  windowCount?: number;
  nodeCount?: number;
  helperTruncated?: boolean;
  elapsedMs?: number;
};
