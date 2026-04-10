import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { isWayland } from './linux-env.ts';

type ScreenshotTool = 'grim' | 'gnome-screenshot' | 'scrot' | 'import';

let cachedTool: { tool: ScreenshotTool; display: 'wayland' | 'x11' } | null = null;

async function resolveScreenshotTool(): Promise<{
  tool: ScreenshotTool;
  display: 'wayland' | 'x11';
}> {
  if (cachedTool) return cachedTool;

  if (isWayland()) {
    if (await whichCmd('grim')) {
      cachedTool = { tool: 'grim', display: 'wayland' };
      return cachedTool;
    }
    if (await whichCmd('gnome-screenshot')) {
      cachedTool = { tool: 'gnome-screenshot', display: 'wayland' };
      return cachedTool;
    }
    throw new AppError(
      'TOOL_MISSING',
      'grim or gnome-screenshot is required for screenshots on Wayland. Install via your package manager.',
    );
  }

  if (await whichCmd('scrot')) {
    cachedTool = { tool: 'scrot', display: 'x11' };
    return cachedTool;
  }
  if (await whichCmd('import')) {
    cachedTool = { tool: 'import', display: 'x11' };
    return cachedTool;
  }
  if (await whichCmd('gnome-screenshot')) {
    cachedTool = { tool: 'gnome-screenshot', display: 'x11' };
    return cachedTool;
  }
  throw new AppError(
    'TOOL_MISSING',
    'scrot, import (ImageMagick), or gnome-screenshot is required for screenshots on X11. Install via your package manager.',
  );
}

/** Reset cached tool (for testing). */
export function resetScreenshotToolCache(): void {
  cachedTool = null;
}

/**
 * Capture a screenshot of the Linux desktop.
 *
 * Uses:
 * - `grim` on Wayland
 * - `scrot` or `import` (ImageMagick) on X11
 */
export async function screenshotLinux(outPath: string): Promise<void> {
  const { tool } = await resolveScreenshotTool();

  switch (tool) {
    case 'grim':
      await runCmd('grim', [outPath]);
      break;
    case 'scrot':
      await runCmd('scrot', [outPath]);
      break;
    case 'import':
      await runCmd('import', ['-window', 'root', outPath]);
      break;
    case 'gnome-screenshot':
      await runCmd('gnome-screenshot', ['-f', outPath]);
      break;
  }
}
