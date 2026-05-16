import { createLinuxToolResolver } from './tool-resolver.ts';
import {
  resolveLinuxToolProvider,
  runLinuxToolCommand,
  type LinuxScreenshotOptions,
} from './tool-provider.ts';

type ScreenshotTool = 'grim' | 'gnome-screenshot' | 'scrot' | 'import';

const screenshotResolver = createLinuxToolResolver<ScreenshotTool>({
  wayland: [
    { tool: 'grim', command: 'grim' },
    { tool: 'gnome-screenshot', command: 'gnome-screenshot' },
  ],
  x11: [
    { tool: 'scrot', command: 'scrot' },
    { tool: 'import', command: 'import' },
    { tool: 'gnome-screenshot', command: 'gnome-screenshot' },
  ],
  waylandError:
    'grim or gnome-screenshot is required for screenshots on Wayland. Install via your package manager.',
  x11Error:
    'scrot, import (ImageMagick), or gnome-screenshot is required for screenshots on X11. Install via your package manager.',
});

/**
 * Capture a screenshot of the Linux desktop.
 *
 * Uses:
 * - `grim` on Wayland
 * - `scrot` or `import` (ImageMagick) on X11
 */
export async function screenshotLinux(
  outPath: string,
  options?: LinuxScreenshotOptions,
): Promise<void> {
  const provider = resolveLinuxToolProvider().screenshot;
  if (provider) {
    await provider.capture(outPath, options);
    return;
  }

  const { tool } = await screenshotResolver.resolve();

  switch (tool) {
    case 'grim':
      await runLinuxToolCommand('grim', [outPath]);
      break;
    case 'scrot':
      await runLinuxToolCommand('scrot', [outPath]);
      break;
    case 'import':
      await runLinuxToolCommand('import', ['-window', 'root', outPath]);
      break;
    case 'gnome-screenshot':
      await runLinuxToolCommand('gnome-screenshot', ['-f', outPath]);
      break;
  }
}
