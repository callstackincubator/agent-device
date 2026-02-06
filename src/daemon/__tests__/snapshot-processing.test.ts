import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRefs } from '../../utils/snapshot.ts';
import {
  findNearestHittableAncestor,
  isFillableType,
  pruneGroupNodes,
  resolveRefLabel,
} from '../snapshot-processing.ts';

test('pruneGroupNodes drops unlabeled group wrappers and rebalances depth', () => {
  const raw = [
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow', label: 'Root' },
    { index: 1, depth: 1, type: 'XCUIElementTypeGroup' },
    { index: 2, depth: 2, type: 'XCUIElementTypeButton', label: 'Continue' },
  ];
  const pruned = pruneGroupNodes(raw);
  assert.equal(pruned.length, 2);
  assert.equal(pruned[1].depth, 1);
  assert.equal(pruned[1].label, 'Continue');
});

test('resolveRefLabel falls back to nearest meaningful neighbor', () => {
  const nodes = attachRefs([
    { index: 0, depth: 0, label: 'Email', rect: { x: 0, y: 10, width: 100, height: 20 } },
    { index: 1, depth: 0, label: '', value: '', rect: { x: 0, y: 14, width: 100, height: 20 } },
  ]);
  const resolved = resolveRefLabel(nodes[1], nodes);
  assert.equal(resolved, 'Email');
});

test('findNearestHittableAncestor walks parents until hittable node', () => {
  const nodes = attachRefs([
    { index: 0, parentIndex: undefined, hittable: true, rect: { x: 0, y: 0, width: 100, height: 40 } },
    { index: 1, parentIndex: 0, hittable: false, rect: { x: 0, y: 0, width: 50, height: 20 } },
    { index: 2, parentIndex: 1, hittable: false, rect: { x: 0, y: 0, width: 20, height: 20 } },
  ]);
  const ancestor = findNearestHittableAncestor(nodes, nodes[2]);
  assert.equal(ancestor?.ref, 'e1');
});

test('isFillableType matches platform-specific editable controls', () => {
  assert.equal(isFillableType('XCUIElementTypeTextField', 'ios'), true);
  assert.equal(isFillableType('XCUIElementTypeButton', 'ios'), false);
  assert.equal(isFillableType('android.widget.EditText', 'android'), true);
  assert.equal(isFillableType('android.widget.Button', 'android'), false);
});
