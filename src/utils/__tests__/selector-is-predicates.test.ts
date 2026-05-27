import assert from 'node:assert/strict';
import { test } from 'vitest';
import { evaluateIsPredicate } from '../selector-is-predicates.ts';
import type { SnapshotNode } from '../snapshot.ts';

test('visible predicate treats zero-height hittable Android nodes as hidden', () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      ref: 'e0',
      type: 'android.widget.FrameLayout',
      rect: { x: 0, y: 0, width: 400, height: 800 },
    },
    {
      index: 1,
      ref: 'e1',
      parentIndex: 0,
      type: 'android.widget.Button',
      identifier: 'tab-4',
      label: 'Tab 4',
      rect: { x: 0, y: 800, width: 100, height: 0 },
      hittable: true,
    },
  ];

  const result = evaluateIsPredicate({
    predicate: 'visible',
    node: nodes[1]!,
    nodes,
    platform: 'android',
  });

  assert.equal(result.pass, false);
});

test('visible predicate treats rectless hittable Android nodes as hidden', () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      ref: 'e0',
      type: 'android.widget.FrameLayout',
      rect: { x: 0, y: 0, width: 400, height: 800 },
    },
    {
      index: 1,
      ref: 'e1',
      type: 'android.widget.Button',
      label: 'Library',
      hittable: true,
    },
  ];

  const result = evaluateIsPredicate({
    predicate: 'visible',
    node: nodes[1]!,
    nodes,
    platform: 'android',
  });

  assert.equal(result.pass, false);
});

test('visible predicate uses visible Android ancestor geometry for rectless text', () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      ref: 'e0',
      type: 'android.widget.FrameLayout',
      rect: { x: 0, y: 0, width: 400, height: 800 },
    },
    {
      index: 1,
      ref: 'e1',
      parentIndex: 0,
      type: 'android.widget.Button',
      label: 'Library',
      rect: { x: 20, y: 100, width: 160, height: 80 },
      hittable: true,
    },
    {
      index: 2,
      ref: 'e2',
      parentIndex: 1,
      type: 'android.widget.TextView',
      label: 'Library',
      hittable: false,
    },
  ];

  const result = evaluateIsPredicate({
    predicate: 'visible',
    node: nodes[2]!,
    nodes,
    platform: 'android',
  });

  assert.equal(result.pass, true);
});
