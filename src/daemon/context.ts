import type { CommandFlags } from '../core/dispatch.ts';
import { getDiagnosticsMeta } from '../utils/diagnostics.ts';

export type DaemonCommandContext = {
  requestId?: string;
  appBundleId?: string;
  activity?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
};

export function contextFromFlags(
  logPath: string,
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
  requestId?: string,
): DaemonCommandContext {
  const effectiveRequestId = requestId ?? getDiagnosticsMeta().requestId;
  return {
    requestId: effectiveRequestId,
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
    count: flags?.count,
    intervalMs: flags?.intervalMs,
    holdMs: flags?.holdMs,
    jitterPx: flags?.jitterPx,
    doubleTap: flags?.doubleTap,
    pauseMs: flags?.pauseMs,
    pattern: flags?.pattern,
  };
}
