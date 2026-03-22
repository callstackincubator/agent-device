import type { MaterializeInstallSource } from '../platforms/install-source.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import type { DeviceInfo, Platform, PlatformSelector } from '../utils/device.ts';
import type { ExecResult } from '../utils/exec.ts';
import type { SnapshotState } from '../utils/snapshot.ts';

export type DaemonInstallSource = MaterializeInstallSource;
export type DaemonLockPolicy = 'reject' | 'strip';

export type DaemonRequest = {
  token: string;
  session: string;
  command: string;
  positionals: string[];
  flags?: CommandFlags;
  runtime?: SessionRuntimeHints;
  meta?: {
    requestId?: string;
    debug?: boolean;
    cwd?: string;
    tenantId?: string;
    runId?: string;
    leaseId?: string;
    leaseTtlMs?: number;
    leaseBackend?: 'ios-simulator';
    sessionIsolation?: 'none' | 'tenant';
    uploadedArtifactId?: string;
    clientArtifactPaths?: Record<string, string>;
    installSource?: DaemonInstallSource;
    retainMaterializedPaths?: boolean;
    materializedPathRetentionMs?: number;
    materializationId?: string;
    lockPolicy?: DaemonLockPolicy;
    lockPlatform?: PlatformSelector;
  };
};

export type SessionRuntimeHints = {
  platform?: 'ios' | 'android';
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  launchUrl?: string;
};

export type DaemonArtifact = {
  field: string;
  artifactId?: string;
  fileName?: string;
  localPath?: string;
  path?: string;
};

export type DaemonResponseData = Record<string, unknown> & {
  artifacts?: DaemonArtifact[];
};

export type DaemonResponse =
  | { ok: true; data?: DaemonResponseData }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        hint?: string;
        diagnosticId?: string;
        logPath?: string;
        details?: Record<string, unknown>;
      };
    };

type RecordingTelemetryBase = {
  tMs: number;
  x: number;
  y: number;
  referenceWidth?: number;
  referenceHeight?: number;
};

type RecordingTelemetryTravel = RecordingTelemetryBase & {
  x2: number;
  y2: number;
  durationMs: number;
};

export type RecordingGestureEvent =
  | (RecordingTelemetryBase & {
      kind: 'tap' | 'longpress';
      durationMs?: number;
    })
  | (RecordingTelemetryTravel & {
      kind: 'swipe';
    })
  | (RecordingTelemetryTravel & {
      kind: 'scroll';
      contentDirection: 'up' | 'down' | 'left' | 'right';
      amount?: number;
    })
  | (RecordingTelemetryTravel & {
      kind: 'back-swipe';
      edge: 'left' | 'right';
    })
  | (RecordingTelemetryBase & {
      kind: 'pinch';
      scale: number;
      durationMs: number;
    });

type SessionRecordingBase = {
  outPath: string;
  clientOutPath?: string;
  telemetryPath?: string;
  startedAt: number;
  showTouches: boolean;
  gestureEvents: RecordingGestureEvent[];
  touchReferenceFrame?: {
    referenceWidth: number;
    referenceHeight: number;
  };
  runnerSessionId?: string;
  invalidatedReason?: string;
};

export type SessionState = {
  name: string;
  device: DeviceInfo;
  createdAt: number;
  appBundleId?: string;
  appName?: string;
  snapshot?: SnapshotState;
  trace?: {
    outPath: string;
    startedAt: number;
  };
  recordSession?: boolean;
  saveScriptPath?: string;
  actions: SessionAction[];
  recording?:
    | (SessionRecordingBase & {
        platform: 'ios';
        child: ReturnType<typeof import('node:child_process').spawn>;
        wait: Promise<ExecResult>;
        remotePath?: string;
      })
    | (SessionRecordingBase & {
        platform: 'android';
        remotePath: string;
        remotePid: string;
      })
    | (SessionRecordingBase & {
        platform: 'ios-device-runner' | 'macos-runner';
        remotePath?: string;
        runnerStartedAtUptimeMs?: number;
        targetAppReadyUptimeMs?: number;
      });
  /** Session-scoped app log stream; logs written to outPath for agent to grep */
  appLog?: {
    platform: Platform;
    backend: 'ios-simulator' | 'ios-device' | 'android';
    outPath: string;
    startedAt: number;
    getState: () => 'active' | 'failed';
    stop: () => Promise<void>;
    wait: Promise<ExecResult>;
  };
};

export type SessionAction = {
  ts: number;
  command: string;
  positionals: string[];
  runtime?: SessionRuntimeHints;
  flags: Partial<CommandFlags> & {
    snapshotInteractiveOnly?: boolean;
    snapshotCompact?: boolean;
    snapshotDepth?: number;
    snapshotScope?: string;
    snapshotRaw?: boolean;
    saveScript?: boolean | string;
    noRecord?: boolean;
  };
  result?: Record<string, unknown>;
};
