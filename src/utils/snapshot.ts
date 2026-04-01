export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type SnapshotOptions = {
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
  waitStableMs?: number;
};

export type RawSnapshotNode = {
  index: number;
  type?: string;
  role?: string;
  subrole?: string;
  label?: string;
  value?: string;
  identifier?: string;
  rect?: Rect;
  enabled?: boolean;
  selected?: boolean;
  hittable?: boolean;
  depth?: number;
  parentIndex?: number;
  pid?: number;
  bundleId?: string;
  appName?: string;
  windowTitle?: string;
  surface?: string;
};

export type SnapshotNode = RawSnapshotNode & {
  ref: string;
};

export type SnapshotState = {
  nodes: SnapshotNode[];
  createdAt: number;
  truncated?: boolean;
  backend?: 'xctest' | 'android' | 'macos-helper';
};

export type ScreenshotOverlayRef = {
  ref: string;
  label?: string;
  rect: Rect;
  overlayRect: Rect;
  center: Point;
};

export function attachRefs(nodes: RawSnapshotNode[]): SnapshotNode[] {
  return nodes.map((node, idx) => ({ ...node, ref: `e${idx + 1}` }));
}

export function normalizeRef(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('@')) {
    const ref = trimmed.slice(1);
    return ref ? ref : null;
  }
  if (trimmed.startsWith('e')) return trimmed;
  return null;
}

export function findNodeByRef(nodes: SnapshotNode[], ref: string): SnapshotNode | null {
  return nodes.find((node) => node.ref === ref) ?? null;
}

export function centerOfRect(rect: Rect): Point {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}
