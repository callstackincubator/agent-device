import type { RawSnapshotNode } from '../../../utils/snapshot.ts';
import { isReactNativeCollapsedWarningLabel } from '../../../utils/react-native-overlay-signals.ts';
import { normalizeType } from '../../snapshot-processing.ts';
import { collectIosScrollIndicatorPresentation } from './scroll.ts';
import {
  areRectsApproximatelyEqual,
  collectDescendants,
  findLargestViewportRect,
  isRepeatedStaticNode,
  isScrollableSnapshotType,
  isSemanticActionNode,
  type SnapshotTreeRuleContext,
} from '../tree.ts';

export function collectIosPresentationNoiseSuppression(
  nodes: RawSnapshotNode[],
  context: SnapshotTreeRuleContext,
): void {
  const { suppressedIndexes } = context;
  collectIosOffscreenKeyboardSuppression(nodes, suppressedIndexes);
  collectIosStructuralIdentifierSuppression(nodes, suppressedIndexes);
  collectIosScrollIndicatorPresentation(nodes, context);
  collectIosSearchToolbarSuppression(nodes, suppressedIndexes);
  collectIosActionWrapperSuppression(nodes, suppressedIndexes);
  collectIosReactNativeOverlayWrapperSuppression(nodes, suppressedIndexes);
  collectIosRepeatedStaticSuppression(nodes, suppressedIndexes);
}

function collectIosReactNativeOverlayWrapperSuppression(
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  forEachOtherNodeWithLabel(nodes, (node, nodeLabel, position) => {
    if (!isReactNativeCollapsedWarningLabel(nodeLabel) || !isFullScreenOverlayRect(node.rect)) {
      return;
    }

    const hasVisibleBannerDescendant = collectDescendants(nodes, position).some(
      (descendant) =>
        descendant.label?.trim() === nodeLabel && isReactNativeCollapsedWarningBanner(descendant),
    );
    if (hasVisibleBannerDescendant) {
      suppressedIndexes.add(node.index);
    }
  });
}

function isFullScreenOverlayRect(rect: RawSnapshotNode['rect']): boolean {
  if (!rect) {
    return false;
  }
  return rect.x <= 1 && rect.y <= 1 && rect.width >= 300 && rect.height >= 600;
}

function isReactNativeCollapsedWarningBanner(node: RawSnapshotNode): boolean {
  if (!node.rect) {
    return false;
  }
  return node.rect.width >= 120 && node.rect.height >= 36 && node.rect.height <= 180;
}

function collectIosRepeatedStaticSuppression(
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  for (let position = 0; position < nodes.length; position += 1) {
    const node = nodes[position];
    const nodeLabel = node?.label?.trim();
    if (!node || suppressedIndexes.has(node.index) || !nodeLabel) {
      continue;
    }

    collectRepeatedStaticSuppressionForNode(nodes, position, node, nodeLabel, suppressedIndexes);
  }
}

function collectRepeatedStaticSuppressionForNode(
  nodes: RawSnapshotNode[],
  position: number,
  node: RawSnapshotNode,
  nodeLabel: string,
  suppressedIndexes: Set<number>,
): void {
  const descendants = collectDescendants(nodes, position);
  const type = normalizeType(node.type ?? '');
  if (type === 'statictext' || type === 'link') {
    suppressRepeatedStaticDescendants(descendants, nodeLabel, suppressedIndexes);
    return;
  }
  if (type !== 'other') {
    return;
  }
  if (hasEquivalentSemanticDescendant(descendants, nodeLabel)) {
    suppressedIndexes.add(node.index);
    return;
  }
  suppressRepeatedStaticDescendants(descendants, nodeLabel, suppressedIndexes);
}

function hasEquivalentSemanticDescendant(
  descendants: RawSnapshotNode[],
  nodeLabel: string,
): boolean {
  return descendants.some((descendant) => {
    const type = normalizeType(descendant.type ?? '');
    return (
      (type === 'link' || type === 'searchfield' || isScrollableSnapshotType(descendant.type)) &&
      descendant.label?.trim() === nodeLabel
    );
  });
}

function suppressRepeatedStaticDescendants(
  descendants: RawSnapshotNode[],
  label: string,
  suppressedIndexes: Set<number>,
): void {
  for (const descendant of descendants) {
    if (isRepeatedStaticNode(descendant, label)) {
      suppressedIndexes.add(descendant.index);
    }
  }
}

function collectIosActionWrapperSuppression(
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  forEachOtherNodeWithLabel(nodes, (node, nodeLabel, position) => {
    const semanticDescendant = collectDescendants(nodes, position).find(
      (descendant) =>
        isSemanticActionNode(descendant) &&
        descendant.label?.trim() === nodeLabel &&
        (areRectsApproximatelyEqual(descendant.rect, node.rect) ||
          isIosBackdropDismissWrapper(node, descendant)),
    );
    if (semanticDescendant) {
      suppressedIndexes.add(node.index);
    }
  });
}

function isIosBackdropDismissWrapper(node: RawSnapshotNode, descendant: RawSnapshotNode): boolean {
  if (descendant.label?.trim() !== node.label?.trim()) {
    return false;
  }
  const descendantType = normalizeType(descendant.type ?? '');
  return (
    isNamedButtonBackdrop(node, descendantType) ||
    descendantType === 'textfield' ||
    isFullscreenActionLabelWrapper(node, descendantType, descendant)
  );
}

function isNamedButtonBackdrop(node: RawSnapshotNode, descendantType: string): boolean {
  const label = node.label?.trim();
  return descendantType === 'button' && (label === 'Dismiss' || label === 'Back');
}

function isFullscreenActionLabelWrapper(
  node: RawSnapshotNode,
  descendantType: string,
  descendant: RawSnapshotNode,
): boolean {
  if (descendantType !== 'button') {
    return false;
  }
  if (!node.rect || !descendant.rect) {
    return false;
  }
  return (
    node.rect.x === 0 &&
    node.rect.y === 0 &&
    node.rect.width >= 300 &&
    node.rect.height >= 600 &&
    descendant.rect.width < node.rect.width
  );
}

function collectIosOffscreenKeyboardSuppression(
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  const viewport = findLargestViewportRect(nodes);
  const screenBottom = viewport ? viewport.y + viewport.height : null;
  if (screenBottom === null) {
    return;
  }
  for (let position = 0; position < nodes.length; position += 1) {
    const node = nodes[position];
    if (!node || !isOffscreenKeyboardNode(node, screenBottom)) {
      continue;
    }
    suppressedIndexes.add(node.index);
    suppressOffscreenKeyboardAncestors(node, nodes, suppressedIndexes, screenBottom);
    for (const descendant of collectDescendants(nodes, position)) {
      suppressedIndexes.add(descendant.index);
    }
  }
}

function isOffscreenKeyboardNode(node: RawSnapshotNode, screenBottom: number): boolean {
  if (!node.rect || normalizeType(node.type ?? '') !== 'keyboard') {
    return false;
  }
  return node.rect.y >= screenBottom;
}

function suppressOffscreenKeyboardAncestors(
  node: RawSnapshotNode,
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
  screenBottom: number,
): void {
  const byIndex = new Map(nodes.map((candidate) => [candidate.index, candidate]));
  let current = typeof node.parentIndex === 'number' ? byIndex.get(node.parentIndex) : undefined;
  while (current?.rect && current.rect.y >= screenBottom) {
    suppressedIndexes.add(current.index);
    current =
      typeof current.parentIndex === 'number' ? byIndex.get(current.parentIndex) : undefined;
  }
}

function collectIosStructuralIdentifierSuppression(
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  for (const node of nodes) {
    if (normalizeType(node.type ?? '') !== 'other') {
      continue;
    }
    if (node.hittable === true || node.label?.trim() || node.value?.trim()) {
      continue;
    }
    if (!node.identifier?.trim()) {
      continue;
    }
    suppressedIndexes.add(node.index);
  }
}

function collectIosSearchToolbarSuppression(
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  for (let position = 0; position < nodes.length; position += 1) {
    const node = nodes[position];
    if (!node || normalizeType(node.type ?? '') !== 'searchfield') {
      continue;
    }
    if (node.label === 'Search') {
      suppressSearchToolbarDescendants(nodes, position, null, suppressedIndexes);
      continue;
    }
    if (node.label !== 'Toolbar') {
      continue;
    }
    const descendants = collectDescendants(nodes, position);
    const innerSearch = descendants.find(
      (candidate) =>
        normalizeType(candidate.type ?? '') === 'searchfield' && candidate.label === 'Search',
    );
    if (!innerSearch) {
      continue;
    }

    suppressedIndexes.add(node.index);
    suppressToolbarAncestors(node, nodes, suppressedIndexes);
    suppressSearchToolbarDescendants(nodes, position, innerSearch.index, suppressedIndexes);
  }
}

function suppressSearchToolbarDescendants(
  nodes: RawSnapshotNode[],
  position: number,
  keptSearchIndex: number | null,
  suppressedIndexes: Set<number>,
): void {
  for (const descendant of collectDescendants(nodes, position)) {
    if (descendant.index === keptSearchIndex) {
      continue;
    }
    if (shouldSuppressIosSearchToolbarDescendant(descendant)) {
      suppressedIndexes.add(descendant.index);
    }
  }
}

function suppressToolbarAncestors(
  node: RawSnapshotNode,
  nodes: RawSnapshotNode[],
  suppressedIndexes: Set<number>,
): void {
  const byIndex = new Map(nodes.map((candidate) => [candidate.index, candidate]));
  let current = node;
  while (typeof current.parentIndex === 'number') {
    const parent = byIndex.get(current.parentIndex);
    if (!parent || parent.label !== 'Toolbar') {
      return;
    }
    suppressedIndexes.add(parent.index);
    current = parent;
  }
}

function shouldSuppressIosSearchToolbarDescendant(node: RawSnapshotNode): boolean {
  const type = normalizeType(node.type ?? '');
  if (type === 'button') {
    return false;
  }
  if (type === 'image') {
    return true;
  }
  return node.label === 'Search';
}

function forEachOtherNodeWithLabel(
  nodes: RawSnapshotNode[],
  visitor: (node: RawSnapshotNode, label: string, position: number) => void,
): void {
  for (let position = 0; position < nodes.length; position += 1) {
    const node = nodes[position];
    const label = node?.label?.trim();
    if (node && label && normalizeType(node.type ?? '') === 'other') {
      visitor(node, label, position);
    }
  }
}
