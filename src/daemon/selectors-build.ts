import type { Platform } from '../utils/device.ts';
import type { SnapshotNode } from '../utils/snapshot.ts';
import { extractNodeText, normalizeType } from './snapshot-processing.ts';
import { uniqueStrings } from './action-utils.ts';
import { isNodeVisible } from './selectors-match.ts';

export function buildSelectorChainForNode(
  node: SnapshotNode,
  _platform: Platform,
  options: { action?: 'click' | 'fill' | 'get' } = {},
): string[] {
  const chain: string[] = [];
  const role = normalizeType(node.type ?? '');
  const id = normalizeSelectorText(node.identifier);
  const label = normalizeSelectorText(node.label);
  const value = normalizeSelectorText(node.value);
  const text = normalizeSelectorText(extractNodeText(node));
  const requireEditable = options.action === 'fill';

  if (id) {
    chain.push(`id=${quoteSelectorValue(id)}`);
  }
  if (role && label) {
    chain.push(
      requireEditable
        ? `role=${quoteSelectorValue(role)} label=${quoteSelectorValue(label)} editable=true`
        : `role=${quoteSelectorValue(role)} label=${quoteSelectorValue(label)}`,
    );
  }
  if (label) {
    chain.push(
      requireEditable
        ? `label=${quoteSelectorValue(label)} editable=true`
        : `label=${quoteSelectorValue(label)}`,
    );
  }
  if (value) {
    chain.push(
      requireEditable
        ? `value=${quoteSelectorValue(value)} editable=true`
        : `value=${quoteSelectorValue(value)}`,
    );
  }
  if (text && text !== label && text !== value) {
    chain.push(
      requireEditable
        ? `text=${quoteSelectorValue(text)} editable=true`
        : `text=${quoteSelectorValue(text)}`,
    );
  }
  if (role && requireEditable && !chain.some((entry) => entry.includes('editable=true'))) {
    chain.push(`role=${quoteSelectorValue(role)} editable=true`);
  }

  const deduped = uniqueStrings(chain);
  if (deduped.length === 0 && role) {
    deduped.push(
      requireEditable
        ? `role=${quoteSelectorValue(role)} editable=true`
        : `role=${quoteSelectorValue(role)}`,
    );
  }
  if (deduped.length === 0) {
    const visible = isNodeVisible(node);
    if (visible) deduped.push('visible=true');
  }
  return deduped;
}

function quoteSelectorValue(value: string): string {
  return JSON.stringify(value);
}

function normalizeSelectorText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}
