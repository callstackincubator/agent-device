import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  findBestMatchesByLocator,
  normalizeRole,
  normalizeText,
  parseFindArgs,
} from '../finders.ts';
import type { SnapshotNode } from '../utils/snapshot.ts';

function makeNode(ref: string, label?: string): SnapshotNode {
  return {
    index: Number(ref.replace('e', '')) || 0,
    ref,
    type: 'XCUIElementTypeButton',
    label,
  };
}

test('public finders entrypoint re-exports pure helpers', () => {
  const nodes: SnapshotNode[] = [makeNode('e1', 'Continue')];

  const parsed = parseFindArgs(['label', 'Continue', 'click']);
  const best = findBestMatchesByLocator(nodes, 'label', 'Continue', true);

  assert.equal(normalizeText('  Continue\nNow  '), 'continue now');
  assert.equal(normalizeRole('XCUIElementTypeApplication.XCUIElementTypeButton'), 'button');
  assert.equal(parsed.action, 'click');
  assert.equal(best.matches.length, 0);
});
