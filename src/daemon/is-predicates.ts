import type { Platform } from '../utils/device.ts';
import type { SnapshotState } from '../utils/snapshot.ts';
import { extractNodeText, normalizeType } from './snapshot-processing.ts';
import { resolveViewportRect } from './scroll-planner.ts';
import { isNodeEditable, isNodeVisible } from './selectors.ts';

type IsPredicate = 'visible' | 'hidden' | 'exists' | 'editable' | 'selected' | 'text';

export function isSupportedPredicate(input: string): input is IsPredicate {
  return ['visible', 'hidden', 'exists', 'editable', 'selected', 'text'].includes(input);
}

export function evaluateIsPredicate(params: {
  predicate: Exclude<IsPredicate, 'exists'>;
  node: SnapshotState['nodes'][number];
  nodes?: SnapshotState['nodes'];
  expectedText?: string;
  platform: Platform;
}): { pass: boolean; actualText: string; details: string } {
  const { predicate, node, nodes, expectedText, platform } = params;
  const actualText = extractNodeText(node);
  const editable = isNodeEditable(node, platform);
  const selected = node.selected === true;
  const visible = predicate === 'text' ? isNodeVisible(node) : isAssertionVisible(node, nodes);
  let pass = false;
  switch (predicate) {
    case 'visible':
      pass = visible;
      break;
    case 'hidden':
      pass = !visible;
      break;
    case 'editable':
      pass = editable;
      break;
    case 'selected':
      pass = selected;
      break;
    case 'text':
      pass = actualText === (expectedText ?? '');
      break;
  }
  const details =
    predicate === 'text'
      ? `expected="${expectedText ?? ''}" actual="${actualText}"`
      : `actual=${JSON.stringify({
          visible,
          editable,
          selected,
        })}`;
  return { pass, actualText, details };
}

function isAssertionVisible(
  node: SnapshotState['nodes'][number],
  nodes: SnapshotState['nodes'] | undefined,
): boolean {
  if (node.hittable === true) return true;
  if (hasPositiveRect(node.rect)) return isRectVisibleInViewport(node.rect, nodes);
  if (node.rect) return false;
  const anchor = resolveVisibilityAnchor(node, nodes);
  if (!anchor) return false;
  if (anchor.hittable === true) return true;
  if (!hasPositiveRect(anchor.rect)) return false;
  return isRectVisibleInViewport(anchor.rect, nodes);
}

function isRectVisibleInViewport(
  rect: NonNullable<SnapshotState['nodes'][number]['rect']>,
  nodes: SnapshotState['nodes'] | undefined,
): boolean {
  if (!nodes?.length) return true;
  const viewport = resolveViewportRect(nodes, rect);
  if (!viewport) return true;
  return rectsIntersect(rect, viewport);
}

function resolveVisibilityAnchor(
  node: SnapshotState['nodes'][number],
  nodes: SnapshotState['nodes'] | undefined,
): SnapshotState['nodes'][number] | null {
  if (!nodes?.length) return null;
  let current = node;
  const visited = new Set<number>();
  while (typeof current.parentIndex === 'number' && !visited.has(current.index)) {
    visited.add(current.index);
    const parent = nodes[current.parentIndex];
    if (!parent) break;
    if (isUsefulVisibilityAnchor(parent)) return parent;
    current = parent;
  }
  return null;
}

function isUsefulVisibilityAnchor(node: SnapshotState['nodes'][number]): boolean {
  const type = normalizeType(node.type ?? '');
  if (
    type.includes('application') ||
    type.includes('window') ||
    type.includes('scrollview') ||
    type.includes('tableview') ||
    type.includes('collectionview') ||
    type === 'table' ||
    type === 'list' ||
    type === 'listview'
  ) {
    return false;
  }
  return node.hittable === true || hasPositiveRect(node.rect);
}

function hasPositiveRect(
  rect: SnapshotState['nodes'][number]['rect'],
): rect is NonNullable<SnapshotState['nodes'][number]['rect']> {
  return Boolean(
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0,
  );
}

function rectsIntersect(
  a: NonNullable<SnapshotState['nodes'][number]['rect']>,
  b: NonNullable<SnapshotState['nodes'][number]['rect']>,
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
