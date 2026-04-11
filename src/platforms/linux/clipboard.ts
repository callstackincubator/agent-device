import { runCmd } from '../../utils/exec.ts';
import { createLinuxToolResolver } from './tool-resolver.ts';

type ClipboardTool = 'wl-clipboard' | 'xclip' | 'xsel';

const clipboardResolver = createLinuxToolResolver<ClipboardTool>({
  wayland: [{ tool: 'wl-clipboard', command: 'wl-paste' }],
  x11: [
    { tool: 'xclip', command: 'xclip' },
    { tool: 'xsel', command: 'xsel' },
  ],
  waylandError:
    'wl-paste (wl-clipboard) is required for clipboard access on Wayland. Install via your package manager.',
  x11Error:
    'xclip or xsel is required for clipboard access on X11. Install via your package manager.',
});

/** Reset cached tool (for testing). */
export const resetClipboardToolCache = clipboardResolver.resetCache;

export async function readLinuxClipboard(): Promise<string> {
  const { tool } = await clipboardResolver.resolve();

  switch (tool) {
    case 'wl-clipboard': {
      const result = await runCmd('wl-paste', ['--no-newline'], {
        allowFailure: true,
        timeoutMs: 5000,
      });
      return result.stdout;
    }
    case 'xclip': {
      const result = await runCmd('xclip', ['-selection', 'clipboard', '-o'], {
        allowFailure: true,
        timeoutMs: 5000,
      });
      return result.stdout;
    }
    case 'xsel': {
      const result = await runCmd('xsel', ['--clipboard', '--output'], {
        allowFailure: true,
        timeoutMs: 5000,
      });
      return result.stdout;
    }
  }
}

export async function writeLinuxClipboard(text: string): Promise<void> {
  const { tool } = await clipboardResolver.resolve();

  switch (tool) {
    case 'wl-clipboard':
      await runCmd('wl-copy', ['--', text], { allowFailure: false, timeoutMs: 5000 });
      break;
    case 'xclip':
      await runCmd('xclip', ['-selection', 'clipboard'], {
        allowFailure: false,
        timeoutMs: 5000,
        stdin: text,
      });
      break;
    case 'xsel':
      await runCmd('xsel', ['--clipboard', '--input'], {
        allowFailure: false,
        timeoutMs: 5000,
        stdin: text,
      });
      break;
  }
}
