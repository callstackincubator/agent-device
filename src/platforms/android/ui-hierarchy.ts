import type { RawSnapshotNode, Rect, SnapshotOptions } from '../../utils/snapshot.ts';

export function findBounds(xml: string, query: string): { x: number; y: number } | null {
  const q = query.toLowerCase();
  const nodeRegex = /<node[^>]+>/g;
  let match = nodeRegex.exec(xml);
  while (match) {
    const node = match[0];
    const attrs = parseXmlNodeAttributes(node);
    const textVal = (readXmlAttr(attrs, 'text') ?? '').toLowerCase();
    const descVal = (readXmlAttr(attrs, 'content-desc') ?? '').toLowerCase();
    if (textVal.includes(q) || descVal.includes(q)) {
      const rect = parseBounds(readXmlAttr(attrs, 'bounds'));
      if (rect) {
        return {
          x: Math.floor(rect.x + rect.width / 2),
          y: Math.floor(rect.y + rect.height / 2),
        };
      }
      return { x: 0, y: 0 };
    }
    match = nodeRegex.exec(xml);
  }
  return null;
}

export function parseUiHierarchy(
  xml: string,
  maxNodes: number,
  options: SnapshotOptions,
): { nodes: RawSnapshotNode[]; truncated?: boolean } {
  const tree = parseUiHierarchyTree(xml);
  const nodes: RawSnapshotNode[] = [];
  let truncated = false;
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
  const scopedRoot = options.scope ? findScopeNode(tree, options.scope) : null;
  const roots = scopedRoot ? [scopedRoot] : tree.children;

  const interactiveDescendantMemo = new Map<AndroidNode, boolean>();
  const hasInteractiveDescendant = (node: AndroidNode): boolean => {
    const cached = interactiveDescendantMemo.get(node);
    if (cached !== undefined) return cached;
    for (const child of node.children) {
      if (child.hittable || hasInteractiveDescendant(child)) {
        interactiveDescendantMemo.set(node, true);
        return true;
      }
    }
    interactiveDescendantMemo.set(node, false);
    return false;
  };

  const walk = (
    node: AndroidNode,
    depth: number,
    parentIndex?: number,
    ancestorHittable: boolean = false,
    ancestorCollection: boolean = false,
  ) => {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) return;

    const include = options.raw
      ? true
      : shouldIncludeAndroidNode(
          node,
          options,
          ancestorHittable,
          hasInteractiveDescendant(node),
          ancestorCollection,
        );
    let currentIndex = parentIndex;
    if (include) {
      currentIndex = nodes.length;
      nodes.push({
        index: currentIndex,
        type: node.type ?? undefined,
        label: node.label ?? undefined,
        value: node.value ?? undefined,
        identifier: node.identifier ?? undefined,
        rect: node.rect,
        enabled: node.enabled,
        hittable: node.hittable,
        depth,
        parentIndex,
      });
    }
    const nextAncestorHittable = ancestorHittable || Boolean(node.hittable);
    const nextAncestorCollection = ancestorCollection || isCollectionContainerType(node.type);
    for (const child of node.children) {
      walk(child, depth + 1, currentIndex, nextAncestorHittable, nextAncestorCollection);
      if (truncated) return;
    }
  };

  for (const root of roots) {
    walk(root, 0, undefined, false, false);
    if (truncated) break;
  }

  return truncated ? { nodes, truncated } : { nodes };
}

export function readNodeAttributes(node: string): {
  text: string | null;
  desc: string | null;
  resourceId: string | null;
  className: string | null;
  bounds: string | null;
  clickable?: boolean;
  enabled?: boolean;
  focusable?: boolean;
  focused?: boolean;
} {
  const attrs = parseXmlNodeAttributes(node);
  const getAttr = (name: string): string | null => readXmlAttr(attrs, name);
  const boolAttr = (name: string): boolean | undefined => {
    const raw = getAttr(name);
    if (raw === null) return undefined;
    return raw === 'true';
  };
  return {
    text: getAttr('text'),
    desc: getAttr('content-desc'),
    resourceId: getAttr('resource-id'),
    className: getAttr('class'),
    bounds: getAttr('bounds'),
    clickable: boolAttr('clickable'),
    enabled: boolAttr('enabled'),
    focusable: boolAttr('focusable'),
    focused: boolAttr('focused'),
  };
}

function parseXmlNodeAttributes(node: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const start = node.indexOf(' ');
  const end = node.lastIndexOf('>');
  if (start < 0 || end <= start) return attrs;

  const attrRegex = /([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/y;
  let cursor = start;
  while (cursor < end) {
    while (cursor < end) {
      const char = node[cursor];
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') break;
      cursor += 1;
    }
    if (cursor >= end) break;
    const char = node[cursor];
    if (char === '/' || char === '>') break;

    attrRegex.lastIndex = cursor;
    const match = attrRegex.exec(node);
    if (!match) break;
    attrs.set(match[1], match[3]);
    cursor = attrRegex.lastIndex;
  }

  return attrs;
}

function readXmlAttr(attrs: Map<string, string>, name: string): string | null {
  return attrs.get(name) ?? null;
}

export function parseBounds(bounds: string | null): Rect | undefined {
  if (!bounds) return undefined;
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds);
  if (!match) return undefined;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

type AndroidNode = {
  type: string | null;
  label: string | null;
  value: string | null;
  identifier: string | null;
  rect?: Rect;
  enabled?: boolean;
  hittable?: boolean;
  depth: number;
  parentIndex?: number;
  children: AndroidNode[];
};

function parseUiHierarchyTree(xml: string): AndroidNode {
  const root: AndroidNode = {
    type: null,
    label: null,
    value: null,
    identifier: null,
    depth: -1,
    children: [],
  };
  const stack: AndroidNode[] = [root];
  const tokenRegex = /<node\b[^>]*>|<\/node>/g;
  let match = tokenRegex.exec(xml);
  while (match) {
    const token = match[0];
    if (token.startsWith('</node')) {
      if (stack.length > 1) stack.pop();
      match = tokenRegex.exec(xml);
      continue;
    }
    const attrs = readNodeAttributes(token);
    const rect = parseBounds(attrs.bounds);
    const parent = stack[stack.length - 1];
    const node: AndroidNode = {
      type: attrs.className,
      label: attrs.text || attrs.desc,
      value: attrs.text,
      identifier: attrs.resourceId,
      rect,
      enabled: attrs.enabled,
      hittable: attrs.clickable ?? attrs.focusable,
      depth: parent.depth + 1,
      parentIndex: undefined,
      children: [],
    };
    parent.children.push(node);
    if (!token.endsWith('/>')) {
      stack.push(node);
    }
    match = tokenRegex.exec(xml);
  }
  return root;
}

function shouldIncludeAndroidNode(
  node: AndroidNode,
  options: SnapshotOptions,
  ancestorHittable: boolean,
  descendantHittable: boolean,
  ancestorCollection: boolean,
): boolean {
  const type = normalizeAndroidType(node.type);
  const hasText = Boolean(node.label && node.label.trim().length > 0);
  const hasId = Boolean(node.identifier && node.identifier.trim().length > 0);
  const hasMeaningfulText = hasText && !isGenericAndroidId(node.label ?? '');
  const hasMeaningfulId = hasId && !isGenericAndroidId(node.identifier ?? '');
  const isStructural = isStructuralAndroidType(type);
  const isVisual = type === 'imageview' || type === 'imagebutton';
  if (options.interactiveOnly) {
    if (node.hittable) return true;
    // Keep text proxies for tappable rows while dropping structural noise.
    const proxyCandidate = hasMeaningfulText || hasMeaningfulId;
    if (!proxyCandidate) return false;
    if (isVisual) return false;
    if (isStructural && !ancestorCollection) return false;
    return ancestorHittable || descendantHittable || ancestorCollection;
  }
  if (options.compact) {
    return hasMeaningfulText || hasMeaningfulId || Boolean(node.hittable);
  }
  if (isStructural || isVisual) {
    if (node.hittable) return true;
    if (hasMeaningfulText) return true;
    if (hasMeaningfulId && descendantHittable) return true;
    return descendantHittable;
  }
  return true;
}

function isCollectionContainerType(type: string | null): boolean {
  if (!type) return false;
  const normalized = normalizeAndroidType(type);
  return (
    normalized.includes('recyclerview') ||
    normalized.includes('listview') ||
    normalized.includes('gridview')
  );
}

function normalizeAndroidType(type: string | null): string {
  if (!type) return '';
  return type.toLowerCase();
}

function isStructuralAndroidType(type: string): boolean {
  const short = type.split('.').pop() ?? type;
  return short.includes('layout') || short === 'viewgroup' || short === 'view';
}

function isGenericAndroidId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[\w.]+:id\/[\w.-]+$/i.test(trimmed);
}

function findScopeNode(root: AndroidNode, scope: string): AndroidNode | null {
  const query = scope.toLowerCase();
  const stack: AndroidNode[] = [...root.children];
  while (stack.length > 0) {
    const node = stack.shift() as AndroidNode;
    const label = node.label?.toLowerCase() ?? '';
    const value = node.value?.toLowerCase() ?? '';
    const identifier = node.identifier?.toLowerCase() ?? '';
    if (label.includes(query) || value.includes(query) || identifier.includes(query)) {
      return node;
    }
    stack.push(...node.children);
  }
  return null;
}
