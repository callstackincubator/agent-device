import type { CommandFlags } from '../core/dispatch.ts';
import type { DeviceInfo } from '../utils/device.ts';
import type { ExecResult } from '../utils/exec.ts';
import type { SnapshotState } from '../utils/snapshot.ts';

export type DaemonRequest = {
  token: string;
  session: string;
  command: string;
  positionals: string[];
  flags?: CommandFlags;
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

export type RecordingGestureEvent =
  | {
    kind: 'tap' | 'longpress';
    tMs: number;
    x: number;
    y: number;
    referenceWidth?: number;
    referenceHeight?: number;
    durationMs?: number;
  }
  | {
    kind: 'swipe';
    tMs: number;
    x: number;
    y: number;
    x2: number;
    y2: number;
    referenceWidth?: number;
    referenceHeight?: number;
    durationMs: number;
  }
  | {
    kind: 'pinch';
    tMs: number;
    x: number;
    y: number;
    referenceWidth?: number;
    referenceHeight?: number;
    scale: number;
    durationMs: number;
  };

type SessionRecordingBase = {
  outPath: string;
  clientOutPath?: string;
  startedAt: number;
  runnerStartedAtUptimeMs?: number;
  showTouches: boolean;
  gestureEvents: RecordingGestureEvent[];
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
      platform: 'ios' | 'android';
      remotePath?: string;
      androidShowTouchesSetting?: string | null;
      child: ReturnType<typeof import('node:child_process').spawn>;
      wait: Promise<ExecResult>;
    })
    | (SessionRecordingBase & {
      platform: 'ios-device-runner';
      remotePath: string;
    });
  /** Session-scoped app log stream; logs written to outPath for agent to grep */
  appLog?: {
    platform: 'ios' | 'android';
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
