import type { CommandFlags } from '../core/dispatch.ts';

export type DaemonCommandContext = {
  appBundleId?: string;
  activity?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotBackend?: 'ax' | 'xctest';
  snapshotRaw?: boolean;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
};

export function contextFromFlags(
  logPath: string,
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
): DaemonCommandContext {
  return {
    appBundleId,
    activity: flags?.activity,
    verbose: flags?.verbose,
    logPath,
    traceLogPath,
    snapshotInteractiveOnly: flags?.snapshotInteractiveOnly,
    snapshotCompact: flags?.snapshotCompact,
    snapshotDepth: flags?.snapshotDepth,
    snapshotScope: flags?.snapshotScope,
    snapshotRaw: flags?.snapshotRaw,
    snapshotBackend: flags?.snapshotBackend,
    count: flags?.count,
    intervalMs: flags?.intervalMs,
    holdMs: flags?.holdMs,
    jitterPx: flags?.jitterPx,
    pauseMs: flags?.pauseMs,
    pattern: flags?.pattern,
  };
}
