import type { CommandFlags, DispatchContext } from '../core/dispatch-context.ts';
import { resolveClickButton } from '../core/click-button.ts';
import {
  screenshotFlagsFromOptions,
  type ScreenshotRuntimeFlags,
} from '../commands/capture-screenshot-options.ts';
import { getDiagnosticsMeta } from '../utils/diagnostics.ts';

export type DaemonCommandContext = DispatchContext & ScreenshotRuntimeFlags;

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
    launchConsole: flags?.launchConsole,
    verbose: flags?.verbose,
    logPath,
    traceLogPath,
    snapshotInteractiveOnly: flags?.snapshotInteractiveOnly,
    snapshotCompact: flags?.snapshotCompact,
    snapshotDepth: flags?.snapshotDepth,
    snapshotScope: flags?.snapshotScope,
    snapshotRaw: flags?.snapshotRaw,
    ...screenshotFlagsFromOptions(flags),
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
  };
}
