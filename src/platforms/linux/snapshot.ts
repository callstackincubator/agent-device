import type { RawSnapshotNode } from '../../utils/snapshot.ts';
import { captureAccessibilityTree, type SnapshotSurface } from './atspi-bridge.ts';
import type { SessionSurface } from '../../core/session-surface.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';

/**
 * Map the session-level surface to an AT-SPI2 surface.
 * Linux supports 'desktop' and 'frontmost-app'. The 'app' surface
 * (used for in-app XCTest sessions) is treated as 'frontmost-app' on Linux.
 * The 'menubar' surface is not yet supported; it falls back to 'desktop'.
 */
function resolveLinuxSurface(surface: SessionSurface | undefined): SnapshotSurface {
  if (surface === 'desktop') return 'desktop';
  if (surface === 'frontmost-app' || surface === 'app') return 'frontmost-app';
  if (surface === 'menubar') {
    emitDiagnostic({
      level: 'warn',
      phase: 'linux_snapshot',
      data: { message: 'menubar surface is not supported on Linux, falling back to desktop' },
    });
  }
  return 'desktop';
}

export async function snapshotLinux(
  surface: SessionSurface | undefined,
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
}> {
  const linuxSurface = resolveLinuxSurface(surface);
  const result = await captureAccessibilityTree(linuxSurface);

  return {
    nodes: result.nodes,
    truncated: result.truncated,
  };
}
