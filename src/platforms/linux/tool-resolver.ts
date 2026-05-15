import { AppError } from '../../utils/errors.ts';
import { isWayland, type DisplayServer } from './linux-env.ts';
import { resolveLinuxToolProvider, type LinuxToolProvider } from './tool-provider.ts';

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
  let cached: { provider: LinuxToolProvider; resolved: ResolvedTool<T> } | null = null;

  async function resolve(): Promise<ResolvedTool<T>> {
    const provider = resolveLinuxToolProvider();
    if (cached?.provider === provider) return cached.resolved;
    const display: DisplayServer = isWayland() ? 'wayland' : 'x11';
    const candidates = display === 'wayland' ? config.wayland : config.x11;
    for (const candidate of candidates) {
      if (await provider.whichCommand(candidate.command)) {
        const resolved = { tool: candidate.tool, display };
        cached = { provider, resolved };
        return resolved;
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
