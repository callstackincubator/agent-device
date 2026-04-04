/**
 * Shared Linux environment detection — display server and input tool.
 *
 * Results are cached after the first probe so that every action
 * (press, type, scroll…) does not re-run `which` on every call.
 */

import { whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';

export type DisplayServer = 'wayland' | 'x11';
export type InputTool = 'xdotool' | 'ydotool';

export function detectDisplayServer(): DisplayServer {
  if (process.env['WAYLAND_DISPLAY']) return 'wayland';
  if (process.env['XDG_SESSION_TYPE'] === 'wayland') return 'wayland';
  return 'x11';
}

export function isWayland(): boolean {
  return detectDisplayServer() === 'wayland';
}

// ── Cached input tool resolution ───────────────────────────────────────

let cachedInputTool: { tool: InputTool; display: DisplayServer } | null = null;

export async function ensureInputTool(): Promise<{
  tool: InputTool;
  display: DisplayServer;
}> {
  if (cachedInputTool) return cachedInputTool;

  const display = detectDisplayServer();

  if (display === 'wayland') {
    if (await whichCmd('ydotool')) {
      cachedInputTool = { tool: 'ydotool', display };
      return cachedInputTool;
    }
    if (await whichCmd('xdotool')) {
      emitDiagnostic({
        level: 'warn',
        phase: 'linux_input_tool',
        data: {
          message: 'Falling back to xdotool on Wayland. Input synthesis may not work — install ydotool for full Wayland support.',
        },
      });
      cachedInputTool = { tool: 'xdotool', display };
      return cachedInputTool;
    }
    throw new AppError(
      'TOOL_MISSING',
      'ydotool is required for input synthesis on Wayland. Install it via your package manager.',
    );
  }

  if (await whichCmd('xdotool')) {
    cachedInputTool = { tool: 'xdotool', display };
    return cachedInputTool;
  }
  throw new AppError(
    'TOOL_MISSING',
    'xdotool is required for input synthesis on X11. Install it via your package manager.',
  );
}

/** Reset cached tool (for testing). */
export function resetInputToolCache(): void {
  cachedInputTool = null;
}
