import type { Platform } from '../utils/device.ts';
import type { SnapshotNode } from '../utils/snapshot.ts';
import { extractNodeText, isFillableType, normalizeType } from './snapshot-processing.ts';
import type { Selector, SelectorTerm } from './selectors-parse.ts';

export function matchesSelector(
  node: SnapshotNode,
  selector: Selector,
  platform: Platform,
): boolean {
  return selector.terms.every((term) => matchesTerm(node, term, platform));
}

export function isNodeVisible(node: SnapshotNode): boolean {
  if (node.hittable === true) return true;
  if (!node.rect) return false;
  return node.rect.width > 0 && node.rect.height > 0;
}

export function isNodeEditable(node: SnapshotNode, platform: Platform): boolean {
  return isFillableType(node.type ?? '', platform) && node.enabled !== false;
}

function matchesTerm(node: SnapshotNode, term: SelectorTerm, platform: Platform): boolean {
  switch (term.key) {
    case 'id':
      return textEquals(node.identifier, String(term.value));
    case 'role':
      return textEquals(normalizeType(node.type ?? ''), String(term.value));
    case 'label':
      return textEquals(node.label, String(term.value));
    case 'value':
      return textEquals(node.value, String(term.value));
    case 'text':
      return textEquals(extractNodeText(node), String(term.value));
    case 'visible':
      return isNodeVisible(node) === Boolean(term.value);
    case 'hidden':
      return !isNodeVisible(node) === Boolean(term.value);
    case 'editable':
      return isNodeEditable(node, platform) === Boolean(term.value);
    case 'selected':
      return Boolean(node.selected === true) === Boolean(term.value);
    case 'enabled':
      return Boolean(node.enabled !== false) === Boolean(term.value);
    case 'hittable':
      return Boolean(node.hittable === true) === Boolean(term.value);
    default:
      return false;
  }
}

function textEquals(value: string | undefined, query: string): boolean {
  return normalizeText(value ?? '') === normalizeText(query);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
