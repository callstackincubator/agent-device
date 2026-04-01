import type { CommandFlags } from '../core/dispatch.ts';
import { resolveClickButton } from '../core/click-button.ts';
import type { SessionSurface } from '../core/session-surface.ts';
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
  snapshotWaitStableMs?: number;
  screenshotFullscreen?: boolean;
  count?: number;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pixels?: number;
  doubleTap?: boolean;
  clickButton?: 'primary' | 'secondary' | 'middle';
  backMode?: 'in-app' | 'system';
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  maxScrolls?: number;
  surface?: SessionSurface;
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
    snapshotWaitStableMs: flags?.snapshotWaitStableMs,
    screenshotFullscreen: flags?.screenshotFullscreen,
    count: flags?.count,
    intervalMs: flags?.intervalMs,
    delayMs: flags?.delayMs,
    holdMs: flags?.holdMs,
    jitterPx: flags?.jitterPx,
    pixels: flags?.pixels,
    doubleTap: flags?.doubleTap,
    clickButton: resolveClickButton(flags),
    backMode: flags?.backMode,
    pauseMs: flags?.pauseMs,
    pattern: flags?.pattern,
    maxScrolls: flags?.maxScrolls,
  };
}
