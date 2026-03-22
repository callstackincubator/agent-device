import type { Rect, SnapshotNode, SnapshotState } from '../utils/snapshot.ts';

export type TouchReferenceFrame = {
  referenceWidth: number;
  referenceHeight: number;
};

type SnapshotReferenceFrameState = SnapshotState & {
  referenceWidth?: number;
  referenceHeight?: number;
};

export function getSnapshotReferenceFrame(
  snapshot: SnapshotState | undefined,
): TouchReferenceFrame | undefined {
  if (!snapshot) return undefined;
  const cachedSnapshot = snapshot as SnapshotReferenceFrameState;
  if (
    typeof cachedSnapshot.referenceWidth === 'number' &&
    cachedSnapshot.referenceWidth > 0 &&
    typeof cachedSnapshot.referenceHeight === 'number' &&
    cachedSnapshot.referenceHeight > 0
  ) {
    return {
      referenceWidth: cachedSnapshot.referenceWidth,
      referenceHeight: cachedSnapshot.referenceHeight,
    };
  }

  const inferred = inferTouchReferenceFrame(snapshot.nodes ?? []);
  if (!inferred) return undefined;
  cachedSnapshot.referenceWidth = inferred.referenceWidth;
  cachedSnapshot.referenceHeight = inferred.referenceHeight;
  return inferred;
}

export function inferTouchReferenceFrame(
  nodes: Array<Pick<SnapshotNode, 'type' | 'rect'>>,
): TouchReferenceFrame | undefined {
  const viewportRect = inferViewportRect(nodes);
  if (!viewportRect) return undefined;
  return {
    referenceWidth: viewportRect.width,
    referenceHeight: viewportRect.height,
  };
}

function inferViewportRect(nodes: Array<Pick<SnapshotNode, 'type' | 'rect'>>): Rect | undefined {
  const candidate = nodes
    .filter((node) => isViewportNode(node.type) && isValidRect(node.rect))
    .map((node) => node.rect)
    .sort(
      (left, right) =>
        (right?.width ?? 0) * (right?.height ?? 0) - (left?.width ?? 0) * (left?.height ?? 0),
    )[0];
  if (candidate) return candidate;

  const rects = nodes.map((node) => node.rect).filter(isValidRect);
  if (rects.length === 0) return undefined;

  const width = Math.max(...rects.map((rect) => rect.x + rect.width));
  const height = Math.max(...rects.map((rect) => rect.y + rect.height));
  if (width <= 0 || height <= 0) return undefined;
  return { x: 0, y: 0, width, height };
}

function isViewportNode(type: string | undefined): boolean {
  if (!type) return false;
  const normalized = type.toLowerCase();
  return normalized.includes('application') || normalized.includes('window');
}

function isValidRect(rect: Rect | undefined): rect is Rect {
  return !!rect && rect.width > 0 && rect.height > 0;
}
