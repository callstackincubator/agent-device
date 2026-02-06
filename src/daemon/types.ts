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
};

export type DaemonResponse =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

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
  actions: SessionAction[];
  recording?: {
    platform: 'ios' | 'android';
    outPath: string;
    remotePath?: string;
    child: ReturnType<typeof import('node:child_process').spawn>;
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
    snapshotBackend?: 'ax' | 'xctest';
    noRecord?: boolean;
    recordJson?: boolean;
  };
  result?: Record<string, unknown>;
};
