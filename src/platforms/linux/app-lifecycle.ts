import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { sleep } from '../../utils/timeouts.ts';
import { sendKey } from './input-actions.ts';
import { resolveLinuxToolProvider, runLinuxToolCommand } from './tool-provider.ts';

/**
 * Open an application or URL on Linux.
 *
 * Accepts:
 * - A URL (opens via xdg-open)
 * - A .desktop file name or binary name
 */
export async function openLinuxApp(app: string): Promise<void> {
  const linuxTools = resolveLinuxToolProvider();
  // URLs or file paths: use xdg-open
  if (app.includes('://') || app.startsWith('/')) {
    await linuxTools.runCommand('xdg-open', [app]);
    return;
  }

  // Try launching as a binary first
  if (await linuxTools.whichCommand(app)) {
    // Fire-and-forget: apps don't exit when launched
    linuxTools.runCommand(app, [], { allowFailure: true }).catch((err) => {
      emitDiagnostic({
        level: 'warn',
        phase: 'linux_app_launch',
        data: { app, error: String(err) },
      });
    });
    // Give it a moment to start
    await sleep(500);
    return;
  }

  // Fallback to xdg-open (handles .desktop file associations)
  await linuxTools.runCommand('xdg-open', [app], { allowFailure: true });
}

/**
 * Close an application by name on Linux.
 *
 * Uses wmctrl if available, falls back to pkill.
 */
export async function closeLinuxApp(app: string): Promise<void> {
  const linuxTools = resolveLinuxToolProvider();
  if (await linuxTools.whichCommand('wmctrl')) {
    await linuxTools.runCommand('wmctrl', ['-c', app], { allowFailure: true });
    return;
  }

  // Fallback: send SIGTERM via pkill (exact process name match)
  await runLinuxToolCommand('pkill', ['-x', app], { allowFailure: true });
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
