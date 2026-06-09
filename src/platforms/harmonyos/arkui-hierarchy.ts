import type { Rect, RawSnapshotNode, SnapshotOptions } from '../../utils/snapshot.ts';

export type ArkUiAttributes = {
  type?: string;
  text?: string;
  originalText?: string;
  description?: string;
  hint?: string;
  accessibilityId?: string;
  id?: string;
  key?: string;
  bounds?: string;
  clickable?: string;
  enabled?: string;
  visible?: string;
  scrollable?: string;
  checkable?: string;
  checked?: string;
  selected?: string;
  focused?: string;
  longClickable?: string;
  bundleName?: string;
  abilityName?: string;
  pagePath?: string;
  [key: string]: string | undefined;
};

export type ArkUiNode = {
  attributes: ArkUiAttributes;
  children?: ArkUiNode[];
};

export type ArkUiTree = ArkUiNode[];

export type ArkUiHierarchyResult = {
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  rawNodeCount: number;
  maxDepth: number;
  bundleName?: string;
  abilityName?: string;
};

export function parseArkUiTree(json: string): ArkUiTree {
  const parsed = JSON.parse(json);
  // ArkUI dumpLayout can output either an array or a single root object
  if (Array.isArray(parsed)) {
    return parsed as ArkUiTree;
  }
  // If it's a single object, wrap it in an array
  if (parsed && typeof parsed === 'object' && parsed.attributes) {
    return [parsed as ArkUiNode];
  }
  throw new Error('ArkUI dumpLayout output must be a JSON array or root object');
}

export function buildArkUiSnapshot(
  tree: ArkUiTree,
  maxNodes: number,
  options: SnapshotOptions,
): ArkUiHierarchyResult {
  let nodeIndex = 0;
  let rawNodeCount = 0;
  let maxDepth = 0;
  let truncated = false;
  let bundleName: string | undefined;
  let abilityName: string | undefined;
  const interactiveDescendantMemo = new WeakMap<ArkUiNode, boolean>();

  const nodes: RawSnapshotNode[] = [];

  function walk(
    node: ArkUiNode,
    depth: number,
    parentIndex: number | null,
    ancestorInteractive: boolean,
  ): void {
    rawNodeCount++;
    if (depth > maxDepth) maxDepth = depth;

    const attrs = node.attributes;
    const type = attrs.type ?? '';
    const isRoot = type === 'root' || type === 'WindowScene';

    // Extract bundle info from root-level nodes
    if (attrs.bundleName) bundleName = attrs.bundleName;
    if (attrs.abilityName) abilityName = attrs.abilityName;

    // Skip invisible nodes unless in raw mode
    if (!options.raw && attrs.visible === 'false' && !isRoot) {
      if (node.children) {
        for (const child of node.children) {
          walk(child, depth + 1, parentIndex, ancestorInteractive);
        }
      }
      return;
    }

    // Skip empty root/WindowScene wrapper nodes, walk their children directly
    if (isRoot && node.children) {
      for (const child of node.children) {
        walk(child, depth + 1, parentIndex, ancestorInteractive);
      }
      return;
    }

    const rect = parseArkUiBounds(attrs.bounds ?? '');
    const hittable = attrs.clickable === 'true' || attrs.longClickable === 'true';
    const scrollable = attrs.scrollable === 'true';
    const text = attrs.text || attrs.originalText || '';
    const description = attrs.description || '';
    const label = text || description || attrs.hint || '';
    const identifier = attrs.accessibilityId || attrs.id || attrs.key || '';
    const enabled = attrs.enabled !== 'false';
    const visible = attrs.visible !== 'false';
    const descendantInteractive = hasInteractiveDescendant(node, interactiveDescendantMemo);

    const shouldInclude = shouldIncludeNode(
      {
        type,
        text,
        description,
        label,
        identifier,
        hittable,
        visible,
        scrollable,
        ancestorInteractive,
        descendantInteractive,
      },
      options,
    );

    if (!shouldInclude) {
      if (node.children) {
        for (const child of node.children) {
          walk(child, depth + 1, parentIndex, ancestorInteractive || hittable || scrollable);
        }
      }
      return;
    }

    const currentIndex = nodeIndex;
    if (nodeIndex >= maxNodes) {
      truncated = true;
      return;
    }

    nodes.push({
      index: currentIndex,
      type,
      label: label || undefined,
      value: text || undefined,
      identifier: identifier || undefined,
      rect,
      enabled,
      hittable,
      selected: attrs.selected === 'true' || attrs.checked === 'true',
      focused: attrs.focused === 'true',
      depth,
      parentIndex: parentIndex ?? undefined,
      bundleId: bundleName,
    });

    nodeIndex++;

    if (node.children) {
      for (const child of node.children) {
        walk(child, depth + 1, currentIndex, ancestorInteractive || hittable || scrollable);
      }
    }
  }

  const scopeRoot =
    options.raw || !options.interactiveOnly
      ? null
      : findBestFocusedInteractiveRoot(tree, interactiveDescendantMemo);

  const roots = scopeRoot ? [scopeRoot] : tree;
  for (const rootNode of roots) {
    // If we're scoping to a focused modal subtree, treat it as an interactive context
    // so proxy label nodes inside the modal are kept for targeting/verification.
    walk(rootNode, 0, null, scopeRoot !== null);
  }

  return {
    nodes,
    truncated: truncated || nodeIndex >= maxNodes,
    rawNodeCount,
    maxDepth,
    bundleName,
    abilityName,
  };
}

function shouldIncludeNode(
  node: {
    type: string;
    text: string;
    description: string;
    label: string;
    identifier: string;
    hittable: boolean;
    visible: boolean;
    scrollable: boolean;
    ancestorInteractive: boolean;
    descendantInteractive: boolean;
  },
  options: SnapshotOptions,
): boolean {
  if (options.raw) return true;

  if (options.interactiveOnly) {
    if (node.hittable) return true;
    if (node.scrollable) return true;
    // Keep proxy label/id nodes only when they are close to interactive controls.
    if (node.label && node.label.length > 0 && node.ancestorInteractive) return true;
    if (node.identifier && node.identifier.length > 0 && node.descendantInteractive) return true;
    return false;
  }

  if (options.compact) {
    if (node.hittable) return true;
    if (node.label && node.label.length > 0) return true;
    if (node.identifier && node.identifier.length > 0) return true;
    return false;
  }

  // Default: include everything that is visible
  return node.visible;
}

function findBestFocusedInteractiveRoot(
  tree: ArkUiTree,
  interactiveDescendantMemo: WeakMap<ArkUiNode, boolean>,
): ArkUiNode | null {
  let best: { node: ArkUiNode; depth: number } | null = null;
  const stack: Array<{ node: ArkUiNode; depth: number }> = tree.map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { node, depth } = current;
    const focused = node.attributes.focused === 'true';
    if (focused && hasInteractiveDescendant(node, interactiveDescendantMemo)) {
      if (!best || depth > best.depth) best = { node, depth };
    }
    for (const child of node.children ?? []) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return best?.node ?? null;
}

function hasInteractiveDescendant(node: ArkUiNode, memo: WeakMap<ArkUiNode, boolean>): boolean {
  const cached = memo.get(node);
  if (cached !== undefined) return cached;
  const attrs = node.attributes;
  const selfInteractive =
    attrs.clickable === 'true' || attrs.longClickable === 'true' || attrs.scrollable === 'true';
  if (selfInteractive) {
    memo.set(node, true);
    return true;
  }
  for (const child of node.children ?? []) {
    if (hasInteractiveDescendant(child, memo)) {
      memo.set(node, true);
      return true;
    }
  }
  memo.set(node, false);
  return false;
}

const BOUNDS_RE = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

export function parseArkUiBounds(bounds: string): Rect | undefined {
  if (!bounds) return undefined;
  const match = bounds.match(BOUNDS_RE);
  if (!match) return undefined;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}
