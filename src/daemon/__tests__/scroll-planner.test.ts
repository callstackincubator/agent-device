import test from 'node:test';
import assert from 'node:assert/strict';
import { type RawSnapshotNode } from '../../utils/snapshot.ts';
import {
  buildScrollIntoViewPlan,
  isRectWithinSafeViewportBand,
  resolveViewportRect,
} from '../scroll-planner.ts';

function makeNode(index: number, type: string, rect?: RawSnapshotNode['rect']): RawSnapshotNode {
  return { index, type, rect };
}

test('resolveViewportRect picks containing application/window viewport', () => {
  const targetRect = { x: 20, y: 1700, width: 120, height: 40 };
  const nodes: RawSnapshotNode[] = [
    makeNode(0, 'Application', { x: 0, y: 0, width: 390, height: 844 }),
    makeNode(1, 'Window', { x: 0, y: 0, width: 390, height: 844 }),
    makeNode(2, 'Cell', targetRect),
  ];
  const viewport = resolveViewportRect(nodes, targetRect);
  assert.deepEqual(viewport, { x: 0, y: 0, width: 390, height: 844 });
});

test('resolveViewportRect returns null when no valid viewport can be inferred', () => {
  const targetRect = { x: 20, y: 100, width: 120, height: 40 };
  const nodes: RawSnapshotNode[] = [makeNode(0, 'Cell', undefined)];
  const viewport = resolveViewportRect(nodes, targetRect);
  assert.equal(viewport, null);
});

test('buildScrollIntoViewPlan computes downward content scroll when target is below safe band', () => {
  const targetRect = { x: 20, y: 2100, width: 120, height: 40 };
  const viewportRect = { x: 0, y: 0, width: 390, height: 844 };
  const plan = buildScrollIntoViewPlan(targetRect, viewportRect);
  assert.ok(plan);
  assert.equal(plan?.direction, 'down');
  assert.ok((plan?.count ?? 0) > 1);
  assert.equal(plan?.x, 80);
  assert.equal(plan?.startY, 726);
  assert.equal(plan?.endY, 118);
});

test('buildScrollIntoViewPlan returns null when already in safe viewport band', () => {
  const targetRect = { x: 20, y: 320, width: 120, height: 40 };
  const viewportRect = { x: 0, y: 0, width: 390, height: 844 };
  const plan = buildScrollIntoViewPlan(targetRect, viewportRect);
  assert.equal(plan, null);
  assert.equal(isRectWithinSafeViewportBand(targetRect, viewportRect), true);
});

test('buildScrollIntoViewPlan keeps swipe lane inside viewport when target center is out of bounds', () => {
  const targetRect = { x: 1000, y: 2100, width: 120, height: 40 };
  const viewportRect = { x: 0, y: 0, width: 390, height: 844 };
  const plan = buildScrollIntoViewPlan(targetRect, viewportRect);
  assert.ok(plan);
  assert.equal(plan?.x, 351);
});
