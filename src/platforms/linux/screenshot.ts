import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { isWayland } from './linux-env.ts';

/**
 * Capture a screenshot of the Linux desktop.
 *
 * Uses:
 * - `grim` on Wayland
 * - `scrot` or `import` (ImageMagick) on X11
 */
export async function screenshotLinux(outPath: string): Promise<void> {
  if (isWayland()) {
    await screenshotWayland(outPath);
  } else {
    await screenshotX11(outPath);
  }
}

async function screenshotWayland(outPath: string): Promise<void> {
  if (await whichCmd('grim')) {
    await runCmd('grim', [outPath]);
    return;
  }
  if (await whichCmd('gnome-screenshot')) {
    await runCmd('gnome-screenshot', ['-f', outPath]);
    return;
  }
  throw new AppError(
    'TOOL_MISSING',
    'grim or gnome-screenshot is required for screenshots on Wayland. Install via your package manager.',
  );
}

async function screenshotX11(outPath: string): Promise<void> {
  if (await whichCmd('scrot')) {
    await runCmd('scrot', [outPath]);
    return;
  }
  if (await whichCmd('import')) {
    await runCmd('import', ['-window', 'root', outPath]);
    return;
  }
  if (await whichCmd('gnome-screenshot')) {
    await runCmd('gnome-screenshot', ['-f', outPath]);
    return;
  }
  throw new AppError(
    'TOOL_MISSING',
    'scrot, import (ImageMagick), or gnome-screenshot is required for screenshots on X11. Install via your package manager.',
  );
}
