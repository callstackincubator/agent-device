import { whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { isWayland, type DisplayServer } from './linux-env.ts';

type ToolCandidate<T extends string> = {
  tool: T;
  command: string;
};

type ResolvedTool<T extends string> = {
  tool: T;
  display: DisplayServer;
};

/**
 * Resolve a Linux tool by probing candidates in order.
 * Caches the result so subsequent calls skip detection.
 */
export function createLinuxToolResolver<T extends string>(config: {
  wayland: ToolCandidate<T>[];
  x11: ToolCandidate<T>[];
  waylandError: string;
  x11Error: string;
}): {
  resolve: () => Promise<ResolvedTool<T>>;
  resetCache: () => void;
} {
  let cached: ResolvedTool<T> | null = null;

  async function resolve(): Promise<ResolvedTool<T>> {
    if (cached) return cached;
    const display: DisplayServer = isWayland() ? 'wayland' : 'x11';
    const candidates = display === 'wayland' ? config.wayland : config.x11;
    for (const candidate of candidates) {
      if (await whichCmd(candidate.command)) {
        cached = { tool: candidate.tool, display };
        return cached;
      }
    }
    throw new AppError(
      'TOOL_MISSING',
      display === 'wayland' ? config.waylandError : config.x11Error,
    );
  }

  return {
    resolve,
    resetCache: () => {
      cached = null;
    },
  };
}
