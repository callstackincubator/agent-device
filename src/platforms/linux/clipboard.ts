import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { isWayland } from './linux-env.ts';

type ClipboardTool = 'wl-clipboard' | 'xclip' | 'xsel';

let cachedTool: { tool: ClipboardTool; display: 'wayland' | 'x11' } | null = null;

async function resolveClipboardTool(): Promise<{
  tool: ClipboardTool;
  display: 'wayland' | 'x11';
}> {
  if (cachedTool) return cachedTool;

  if (isWayland()) {
    // wl-clipboard provides both wl-paste and wl-copy
    if (await whichCmd('wl-paste')) {
      cachedTool = { tool: 'wl-clipboard', display: 'wayland' };
      return cachedTool;
    }
    throw new AppError(
      'TOOL_MISSING',
      'wl-paste (wl-clipboard) is required for clipboard access on Wayland. Install via your package manager.',
    );
  }

  if (await whichCmd('xclip')) {
    cachedTool = { tool: 'xclip', display: 'x11' };
    return cachedTool;
  }
  if (await whichCmd('xsel')) {
    cachedTool = { tool: 'xsel', display: 'x11' };
    return cachedTool;
  }
  throw new AppError(
    'TOOL_MISSING',
    'xclip or xsel is required for clipboard access on X11. Install via your package manager.',
  );
}

/** Reset cached tool (for testing). */
export function resetClipboardToolCache(): void {
  cachedTool = null;
}

export async function readLinuxClipboard(): Promise<string> {
  const { tool } = await resolveClipboardTool();

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
  const { tool } = await resolveClipboardTool();

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
