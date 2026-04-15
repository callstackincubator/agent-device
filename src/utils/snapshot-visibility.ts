import { buildMobileSnapshotPresentation } from './mobile-snapshot-semantics.ts';
import type { SnapshotBackend, SnapshotState, SnapshotVisibility } from './snapshot.ts';

function isDesktopBackend(backend: SnapshotBackend | undefined): boolean {
  return backend === 'macos-helper' || backend === 'linux-atspi';
}

export function buildSnapshotVisibility(params: {
  nodes: SnapshotState['nodes'];
  backend?: SnapshotState['backend'];
  snapshotRaw?: boolean;
}): SnapshotVisibility {
  const { nodes, backend, snapshotRaw } = params;
  if (snapshotRaw || isDesktopBackend(backend)) {
    return {
      partial: false,
      visibleNodeCount: nodes.length,
      totalNodeCount: nodes.length,
      reasons: [],
    };
  }

  const presentation = buildMobileSnapshotPresentation(nodes);
  const reasons = new Set<SnapshotVisibility['reasons'][number]>();
  if (presentation.hiddenCount > 0) {
    reasons.add('offscreen-nodes');
  }
  if (presentation.nodes.some((node) => node.hiddenContentAbove)) {
    reasons.add('scroll-hidden-above');
  }
  if (presentation.nodes.some((node) => node.hiddenContentBelow)) {
    reasons.add('scroll-hidden-below');
  }

  return {
    partial: reasons.size > 0,
    visibleNodeCount: presentation.nodes.length,
    totalNodeCount: nodes.length,
    reasons: [...reasons],
  };
}
