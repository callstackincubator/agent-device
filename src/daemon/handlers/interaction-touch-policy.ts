import type { DaemonResponse, SessionState } from '../types.ts';

export function unsupportedMacOsDesktopSurfaceInteraction(
  session: SessionState,
  command: 'click' | 'press' | 'fill',
): DaemonResponse | null {
  if (session.device.platform !== 'macos') {
    return null;
  }
  if (session.surface !== 'desktop' && session.surface !== 'menubar') {
    return null;
  }
  if (session.surface === 'menubar' && (command === 'click' || command === 'press')) {
    return null;
  }
  return {
    ok: false,
    error: {
      code: 'UNSUPPORTED_OPERATION',
      message: `${command} is not supported on macOS ${session.surface} sessions yet. Open an app session to act, or use the ${session.surface} surface to inspect.`,
    },
  };
}
