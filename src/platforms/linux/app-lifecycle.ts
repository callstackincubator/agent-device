import { runCmd, whichCmd } from '../../utils/exec.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { sendKey } from './input-actions.ts';

/**
 * Open an application or URL on Linux.
 *
 * Accepts:
 * - A URL (opens via xdg-open)
 * - A .desktop file name or binary name
 */
export async function openLinuxApp(app: string): Promise<void> {
  // URLs or file paths: use xdg-open
  if (app.includes('://') || app.startsWith('/')) {
    await runCmd('xdg-open', [app]);
    return;
  }

  // Try launching as a binary first
  if (await whichCmd(app)) {
    // Fire-and-forget: apps don't exit when launched
    runCmd(app, [], { allowFailure: true }).catch((err) => {
      emitDiagnostic({
        level: 'warn',
        phase: 'linux_app_launch',
        data: { app, error: String(err) },
      });
    });
    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 500));
    return;
  }

  // Fallback to xdg-open (handles .desktop file associations)
  await runCmd('xdg-open', [app], { allowFailure: true });
}

/**
 * Close an application by name on Linux.
 *
 * Uses wmctrl if available, falls back to pkill.
 */
export async function closeLinuxApp(app: string): Promise<void> {
  if (await whichCmd('wmctrl')) {
    await runCmd('wmctrl', ['-c', app], { allowFailure: true });
    return;
  }

  // Fallback: send SIGTERM via pkill (exact process name match)
  await runCmd('pkill', ['-x', app], { allowFailure: true });
}

/**
 * Send Alt+Left arrow to go back (standard browser/app back navigation).
 */
export async function backLinux(): Promise<void> {
  // Alt=56, Left=105
  await sendKey('alt+Left', ['56:1', '105:1', '105:0', '56:0']);
}

/**
 * Show desktop (minimize all windows) via Super+D.
 */
export async function homeLinux(): Promise<void> {
  // Super=125, D=32
  await sendKey('super+d', ['125:1', '32:1', '32:0', '125:0']);
}
