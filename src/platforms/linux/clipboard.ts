import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { isWayland } from './linux-env.ts';

export async function readLinuxClipboard(): Promise<string> {
  if (isWayland()) {
    if (await whichCmd('wl-paste')) {
      const result = await runCmd('wl-paste', ['--no-newline'], { allowFailure: true, timeoutMs: 5000 });
      return result.stdout;
    }
    throw new AppError(
      'TOOL_MISSING',
      'wl-paste (wl-clipboard) is required for clipboard access on Wayland. Install via your package manager.',
    );
  }

  // X11
  if (await whichCmd('xclip')) {
    const result = await runCmd('xclip', ['-selection', 'clipboard', '-o'], { allowFailure: true, timeoutMs: 5000 });
    return result.stdout;
  }
  if (await whichCmd('xsel')) {
    const result = await runCmd('xsel', ['--clipboard', '--output'], { allowFailure: true, timeoutMs: 5000 });
    return result.stdout;
  }
  throw new AppError(
    'TOOL_MISSING',
    'xclip or xsel is required for clipboard access on X11. Install via your package manager.',
  );
}

export async function writeLinuxClipboard(text: string): Promise<void> {
  if (isWayland()) {
    if (await whichCmd('wl-copy')) {
      await runCmd('wl-copy', ['--', text], { allowFailure: false, timeoutMs: 5000 });
      return;
    }
    throw new AppError(
      'TOOL_MISSING',
      'wl-copy (wl-clipboard) is required for clipboard access on Wayland. Install via your package manager.',
    );
  }

  // X11: pipe text via stdin — xclip reads from stdin by default
  if (await whichCmd('xclip')) {
    await runCmd('xclip', ['-selection', 'clipboard'], { allowFailure: false, timeoutMs: 5000, stdin: text });
    return;
  }
  if (await whichCmd('xsel')) {
    await runCmd('xsel', ['--clipboard', '--input'], { allowFailure: false, timeoutMs: 5000, stdin: text });
    return;
  }
  throw new AppError(
    'TOOL_MISSING',
    'xclip or xsel is required for clipboard access on X11. Install via your package manager.',
  );
}
