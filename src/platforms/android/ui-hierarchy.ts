import type { RawSnapshotNode, Rect, SnapshotOptions } from '../../utils/snapshot.ts';
import { isScrollableType } from '../../utils/scrollable.ts';

export type AndroidSnapshotAnalysis = {
  rawNodeCount: number;
  maxDepth: number;
};

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
): { nodes: RawSnapshotNode[]; truncated?: boolean; analysis: AndroidSnapshotAnalysis } {
  const tree = parseUiHierarchyTree(xml);
  const { sourceNodes: _sourceNodes, ...snapshot } = buildUiHierarchySnapshot(
    tree,
    maxNodes,
    options,
  );
  return snapshot;
}

export type AndroidBuiltSnapshot = {
  nodes: RawSnapshotNode[];
  sourceNodes: AndroidUiHierarchy[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
};

type AndroidSnapshotBuildState = {
  nodes: RawSnapshotNode[];
  sourceNodes: AndroidUiHierarchy[];
  maxNodes: number;
  maxDepth: number;
  options: SnapshotOptions;
  analysis: AndroidSnapshotAnalysis;
  interactiveDescendantMemo: Map<AndroidNode, boolean>;
  truncated: boolean;
};

export function buildUiHierarchySnapshot(
  tree: AndroidUiHierarchy,
  maxNodes: number,
  options: SnapshotOptions,
): AndroidBuiltSnapshot {
  const state: AndroidSnapshotBuildState = {
    nodes: [],
    sourceNodes: [],
    maxNodes,
    maxDepth: options.depth ?? Number.POSITIVE_INFINITY,
    options,
    analysis: analyzeAndroidTree(tree),
    interactiveDescendantMemo: new Map(),
    truncated: false,
  };
  const scopedRoot = options.scope ? findScopeNode(tree, options.scope) : null;
  const roots = scopedRoot ? [scopedRoot] : tree.children;

  for (const root of roots) {
    walkUiHierarchyNode(state, root, 0);
    if (state.truncated) break;
  }

  const snapshot = {
    nodes: state.nodes,
    sourceNodes: state.sourceNodes,
    analysis: state.analysis,
  };
  return state.truncated ? { ...snapshot, truncated: true } : snapshot;
}

function walkUiHierarchyNode(
  state: AndroidSnapshotBuildState,
  node: AndroidNode,
  depth: number,
  parentIndex?: number,
  ancestorHittable: boolean = false,
  ancestorCollection: boolean = false,
): void {
  if (state.nodes.length >= state.maxNodes) {
    state.truncated = true;
    return;
  }
  if (depth > state.maxDepth) return;

  const include = state.options.raw
    ? true
    : shouldIncludeAndroidNode(
        node,
        state.options,
        ancestorHittable,
        hasInteractiveDescendant(state, node),
        ancestorCollection,
      );
  const currentIndex = include
    ? appendAndroidSnapshotNode(state, node, depth, parentIndex)
    : parentIndex;
  const nextAncestorHittable = ancestorHittable || Boolean(node.hittable);
  const nextAncestorCollection = ancestorCollection || isCollectionContainerType(node.type);
  for (const child of node.children) {
    walkUiHierarchyNode(
      state,
      child,
      depth + 1,
      currentIndex,
      nextAncestorHittable,
      nextAncestorCollection,
    );
    if (state.truncated) return;
  }
}

function appendAndroidSnapshotNode(
  state: AndroidSnapshotBuildState,
  node: AndroidNode,
  depth: number,
  parentIndex?: number,
): number {
  const currentIndex = state.nodes.length;
  state.sourceNodes.push(node);
  state.nodes.push({
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
    ...(node.hiddenContentAbove ? { hiddenContentAbove: true } : {}),
    ...(node.hiddenContentBelow ? { hiddenContentBelow: true } : {}),
  });
  return currentIndex;
}

function hasInteractiveDescendant(state: AndroidSnapshotBuildState, node: AndroidNode): boolean {
  const cached = state.interactiveDescendantMemo.get(node);
  if (cached !== undefined) return cached;
  for (const child of node.children) {
    if (child.hittable || hasInteractiveDescendant(state, child)) {
      state.interactiveDescendantMemo.set(node, true);
      return true;
    }
  }
  state.interactiveDescendantMemo.set(node, false);
  return false;
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

  let cursor = start;
  while (cursor < end) {
    cursor = skipXmlWhitespace(node, cursor, end);
    if (cursor >= end) break;
    const char = node[cursor];
    if (char === '/' || char === '>') break;

    const nameStart = cursor;
    while (cursor < end && !isXmlAttributeNameTerminator(node[cursor] ?? '')) {
      cursor += 1;
    }
    const name = node.slice(nameStart, cursor);
    cursor = skipXmlWhitespace(node, cursor, end);
    if (!name || node[cursor] !== '=') break;
    cursor = skipXmlWhitespace(node, cursor + 1, end);

    const quote = node[cursor];
    if (quote !== '"' && quote !== "'") break;
    cursor += 1;

    const valueStart = cursor;
    while (cursor < end && node[cursor] !== quote) {
      cursor += 1;
    }
    if (cursor >= end) break;
    attrs.set(name, decodeXmlAttributeValue(node.slice(valueStart, cursor)));
    cursor += 1;
  }

  return attrs;
}

function skipXmlWhitespace(value: string, cursor: number, end: number): number {
  while (cursor < end && isXmlWhitespace(value[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

function isXmlWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function isXmlAttributeNameTerminator(char: string): boolean {
  return char === '=' || char === '/' || char === '>' || isXmlWhitespace(char);
}

function decodeXmlAttributeValue(value: string): string {
  let decoded = '';
  let cursor = 0;
  while (cursor < value.length) {
    const entityStart = value.indexOf('&', cursor);
    if (entityStart < 0) {
      decoded += value.slice(cursor);
      break;
    }
    decoded += value.slice(cursor, entityStart);
    const entityEnd = value.indexOf(';', entityStart + 1);
    if (entityEnd < 0) {
      decoded += value.slice(entityStart);
      break;
    }
    const rawEntity = value.slice(entityStart + 1, entityEnd);
    decoded += decodeXmlEntity(rawEntity) ?? value.slice(entityStart, entityEnd + 1);
    cursor = entityEnd + 1;
  }
  return decoded;
}

function decodeXmlEntity(entity: string): string | undefined {
  switch (entity) {
    case 'amp':
      return '&';
    case 'lt':
      return '<';
    case 'gt':
      return '>';
    case 'quot':
      return '"';
    case 'apos':
      return "'";
    default:
      return decodeNumericXmlEntity(entity);
  }
}

function decodeNumericXmlEntity(entity: string): string | undefined {
  if (!entity.startsWith('#')) return undefined;
  const radix = entity[1]?.toLowerCase() === 'x' ? 16 : 10;
  const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
  if (!digits || !isValidNumericEntityDigits(digits, radix)) return undefined;
  const codePoint = Number.parseInt(digits, radix);
  if (!Number.isFinite(codePoint)) return undefined;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
}

function isValidNumericEntityDigits(digits: string, radix: 10 | 16): boolean {
  for (const digit of digits) {
    const code = digit.charCodeAt(0);
    const isDecimal = code >= 48 && code <= 57;
    if (radix === 10) {
      if (!isDecimal) return false;
      continue;
    }
    const isUpperHex = code >= 65 && code <= 70;
    const isLowerHex = code >= 97 && code <= 102;
    if (!isDecimal && !isUpperHex && !isLowerHex) return false;
  }
  return true;
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

export type AndroidUiHierarchy = {
  type: string | null;
  label: string | null;
  value: string | null;
  identifier: string | null;
  rect?: Rect;
  enabled?: boolean;
  hittable?: boolean;
  depth: number;
  parentIndex?: number;
  hiddenContentAbove?: boolean;
  hiddenContentBelow?: boolean;
  children: AndroidNode[];
};

type AndroidNode = AndroidUiHierarchy;

type AndroidNodeInclusionInfo = {
  type: string;
  hasMeaningfulText: boolean;
  hasMeaningfulId: boolean;
  isStructural: boolean;
  isVisual: boolean;
};

export function parseUiHierarchyTree(xml: string): AndroidUiHierarchy {
  const root: AndroidUiHierarchy = {
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
    const node: AndroidUiHierarchy = {
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
  const info = getAndroidNodeInclusionInfo(node);
  if (options.interactiveOnly) {
    return shouldIncludeInteractiveAndroidNode(
      node,
      info,
      ancestorHittable,
      descendantHittable,
      ancestorCollection,
    );
  }
  if (options.compact) {
    return info.hasMeaningfulText || info.hasMeaningfulId || Boolean(node.hittable);
  }
  if (info.isStructural || info.isVisual) {
    return shouldIncludeStructuralAndroidNode(node, info, descendantHittable);
  }
  return true;
}

function getAndroidNodeInclusionInfo(node: AndroidNode): AndroidNodeInclusionInfo {
  const type = normalizeAndroidType(node.type);
  const hasText = Boolean(node.label && node.label.trim().length > 0);
  const hasId = Boolean(node.identifier && node.identifier.trim().length > 0);
  return {
    type,
    hasMeaningfulText: hasText && !isGenericAndroidId(node.label ?? ''),
    hasMeaningfulId: hasId && !isGenericAndroidId(node.identifier ?? ''),
    isStructural: isStructuralAndroidType(type),
    isVisual: type === 'imageview' || type === 'imagebutton',
  };
}

function shouldIncludeInteractiveAndroidNode(
  node: AndroidNode,
  info: AndroidNodeInclusionInfo,
  ancestorHittable: boolean,
  descendantHittable: boolean,
  ancestorCollection: boolean,
): boolean {
  if (node.hittable) return true;
  if (isScrollableType(info.type) && descendantHittable) return true;
  return shouldIncludeInteractiveProxyNode(
    info,
    ancestorHittable,
    descendantHittable,
    ancestorCollection,
  );
}

function shouldIncludeInteractiveProxyNode(
  info: AndroidNodeInclusionInfo,
  ancestorHittable: boolean,
  descendantHittable: boolean,
  ancestorCollection: boolean,
): boolean {
  if (!info.hasMeaningfulText && !info.hasMeaningfulId) return false;
  if (info.isVisual) return false;
  if (info.isStructural && !ancestorCollection) return false;
  return ancestorHittable || descendantHittable || ancestorCollection;
}

function shouldIncludeStructuralAndroidNode(
  node: AndroidNode,
  info: AndroidNodeInclusionInfo,
  descendantHittable: boolean,
): boolean {
  if (node.hittable) return true;
  if (info.hasMeaningfulText) return true;
  if (info.hasMeaningfulId && descendantHittable) return true;
  return descendantHittable;
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
  const queue: AndroidNode[] = [...root.children];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++] as AndroidNode;
    const label = node.label?.toLowerCase() ?? '';
    const value = node.value?.toLowerCase() ?? '';
    const identifier = node.identifier?.toLowerCase() ?? '';
    if (label.includes(query) || value.includes(query) || identifier.includes(query)) {
      return node;
    }
    queue.push(...node.children);
  }
  return null;
}

function analyzeAndroidTree(root: AndroidNode): AndroidSnapshotAnalysis {
  let rawNodeCount = 0;
  let maxDepth = 0;
  const stack = [...root.children];
  while (stack.length > 0) {
    const node = stack.pop() as AndroidNode;
    rawNodeCount += 1;
    maxDepth = Math.max(maxDepth, node.depth);
    stack.push(...node.children);
  }
  return { rawNodeCount, maxDepth };
}
