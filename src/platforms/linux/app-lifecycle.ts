import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';

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
    runCmd(app, [], { allowFailure: true }).catch(() => {});
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

  // Fallback: send SIGTERM via pkill (case-insensitive match)
  await runCmd('pkill', ['-f', app], { allowFailure: true });
}

/**
 * Send Alt+Left arrow to go back (standard browser/app back navigation).
 */
export async function backLinux(): Promise<void> {
  const tool = (await whichCmd('xdotool')) ? 'xdotool' : (await whichCmd('ydotool')) ? 'ydotool' : null;
  if (!tool) {
    throw new AppError('TOOL_MISSING', 'xdotool or ydotool is required for back navigation on Linux.');
  }

  if (tool === 'xdotool') {
    await runCmd('xdotool', ['key', '--clearmodifiers', 'alt+Left']);
  } else {
    // ydotool: Alt=56, Left=105 via scancodes
    await runCmd('ydotool', ['key', '56:1', '105:1', '105:0', '56:0']);
  }
}

/**
 * Show desktop (minimize all windows) via Super+D.
 */
export async function homeLinux(): Promise<void> {
  const tool = (await whichCmd('xdotool')) ? 'xdotool' : (await whichCmd('ydotool')) ? 'ydotool' : null;
  if (!tool) {
    throw new AppError('TOOL_MISSING', 'xdotool or ydotool is required for home action on Linux.');
  }

  if (tool === 'xdotool') {
    await runCmd('xdotool', ['key', '--clearmodifiers', 'super+d']);
  } else {
    // ydotool: Super=125, D=32
    await runCmd('ydotool', ['key', '125:1', '32:1', '32:0', '125:0']);
  }
}
