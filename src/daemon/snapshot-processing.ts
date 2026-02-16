import type { RawSnapshotNode, SnapshotState } from '../utils/snapshot.ts';

export function findNodeByLabel(nodes: SnapshotState['nodes'], label: string) {
  const query = label.toLowerCase();
  return (
    nodes.find((node) => {
      const labelValue = (node.label ?? '').toLowerCase();
      const valueValue = (node.value ?? '').toLowerCase();
      const idValue = (node.identifier ?? '').toLowerCase();
      return labelValue.includes(query) || valueValue.includes(query) || idValue.includes(query);
    }) ?? null
  );
}

export function resolveRefLabel(
  node: SnapshotState['nodes'][number],
  nodes: SnapshotState['nodes'],
): string | undefined {
  const primary = [node.label, node.value, node.identifier]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value && value.length > 0);
  if (primary && isMeaningfulLabel(primary)) return primary;
  const fallback = findNearestMeaningfulLabel(node, nodes);
  return fallback ?? (primary && isMeaningfulLabel(primary) ? primary : undefined);
}

function isMeaningfulLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(true|false)$/i.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

function findNearestMeaningfulLabel(
  target: SnapshotState['nodes'][number],
  nodes: SnapshotState['nodes'],
): string | undefined {
  if (!target.rect) return undefined;
  const targetY = target.rect.y + target.rect.height / 2;
  let best: { label: string; distance: number } | null = null;
  for (const node of nodes) {
    if (!node.rect) continue;
    const label = [node.label, node.value, node.identifier]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => value && value.length > 0);
    if (!label || !isMeaningfulLabel(label)) continue;
    const nodeY = node.rect.y + node.rect.height / 2;
    const distance = Math.abs(nodeY - targetY);
    if (!best || distance < best.distance) {
      best = { label, distance };
    }
  }
  return best?.label;
}

export function pruneGroupNodes(nodes: RawSnapshotNode[]): RawSnapshotNode[] {
  const skippedDepths: number[] = [];
  const result: RawSnapshotNode[] = [];
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    while (skippedDepths.length > 0 && depth <= skippedDepths[skippedDepths.length - 1]) {
      skippedDepths.pop();
    }
    const type = normalizeType(node.type ?? '');
    const labelCandidate = [node.label, node.value, node.identifier]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => value && value.length > 0);
    const hasMeaningfulLabel = labelCandidate ? isMeaningfulLabel(labelCandidate) : false;
    if ((type === 'group' || type === 'ioscontentgroup') && !hasMeaningfulLabel) {
      skippedDepths.push(depth);
      continue;
    }
    const adjustedDepth = Math.max(0, depth - skippedDepths.length);
    result.push({ ...node, depth: adjustedDepth });
  }
  return result;
}

export function normalizeType(type: string): string {
  let value = type.trim().replace(/XCUIElementType/gi, '').toLowerCase();
  const lastSeparator = Math.max(value.lastIndexOf('.'), value.lastIndexOf('/'));
  if (lastSeparator !== -1) {
    value = value.slice(lastSeparator + 1);
  }
  return value;
}

export function isFillableType(type: string, platform: 'ios' | 'android'): boolean {
  const normalized = normalizeType(type);
  if (!normalized) return true;
  if (platform === 'android') {
    return normalized.includes('edittext') || normalized.includes('autocompletetextview');
  }
  return (
    normalized.includes('textfield') ||
    normalized.includes('securetextfield') ||
    normalized.includes('searchfield') ||
    normalized.includes('textview') ||
    normalized.includes('textarea') ||
    normalized === 'search'
  );
}

export function findNearestHittableAncestor(
  nodes: SnapshotState['nodes'],
  node: SnapshotState['nodes'][number],
): SnapshotState['nodes'][number] | null {
  if (node.hittable) return node;
  let current = node;
  const visited = new Set<string>();
  while (current.parentIndex !== undefined) {
    if (visited.has(current.ref)) break;
    visited.add(current.ref);
    const parent = nodes[current.parentIndex];
    if (!parent) break;
    if (parent.hittable) return parent;
    current = parent;
  }
  return null;
}

export function extractNodeText(node: SnapshotState['nodes'][number]): string {
  const candidates = [node.label, node.value, node.identifier]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return candidates[0] ?? '';
}
