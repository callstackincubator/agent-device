import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildMobileSnapshotPresentation,
  isNodeVisibleInEffectiveViewport,
} from '../mobile-snapshot-semantics.ts';
import type { SnapshotNode } from '../snapshot.ts';

test('mobile presentation keeps only visible nodes and adds off-screen summary fallback', () => {
  const nodes: SnapshotNode[] = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'Window',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      ref: 'e2',
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeButton',
      label: 'Visible action',
      rect: { x: 20, y: 140, width: 160, height: 44 },
      hittable: true,
    },
    {
      ref: 'e3',
      index: 2,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeButton',
      label: 'Later action',
      rect: { x: 20, y: 1100, width: 160, height: 44 },
      hittable: true,
    },
  ];

  const presentation = buildMobileSnapshotPresentation(nodes);
  assert.equal(presentation.nodes.length, 2);
  assert.equal(presentation.hiddenCount, 1);
  assert.deepEqual(presentation.summaryLines, [
    '[off-screen below] 1 interactive item: "Later action"',
  ]);
});

test('mobile presentation assigns hidden content hints to visible scroll containers', () => {
  const nodes: SnapshotNode[] = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'Window',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      ref: 'e2',
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'android.widget.ScrollView',
      label: 'Messages',
      rect: { x: 0, y: 140, width: 390, height: 500 },
    },
    {
      ref: 'e3',
      index: 2,
      depth: 2,
      parentIndex: 1,
      type: 'android.widget.Button',
      label: 'Older',
      rect: { x: 20, y: 60, width: 350, height: 44 },
      hittable: true,
    },
    {
      ref: 'e4',
      index: 3,
      depth: 2,
      parentIndex: 1,
      type: 'android.widget.Button',
      label: 'Visible',
      rect: { x: 20, y: 260, width: 350, height: 44 },
      hittable: true,
    },
    {
      ref: 'e5',
      index: 4,
      depth: 2,
      parentIndex: 1,
      type: 'android.widget.Button',
      label: 'Newer',
      rect: { x: 20, y: 680, width: 350, height: 44 },
      hittable: true,
    },
  ];

  const presentation = buildMobileSnapshotPresentation(nodes);
  const container = presentation.nodes.find((node) => node.index === 1);
  assert.equal(container?.hiddenContentAbove, true);
  assert.equal(container?.hiddenContentBelow, true);
  assert.deepEqual(presentation.summaryLines, []);
});

test('visibility checks use nearest scroll container clipping viewport', () => {
  const nodes: SnapshotNode[] = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'Window',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      ref: 'e2',
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'android.widget.ScrollView',
      rect: { x: 0, y: 120, width: 390, height: 500 },
    },
    {
      ref: 'e3',
      index: 2,
      depth: 2,
      parentIndex: 1,
      type: 'android.widget.TextView',
      label: 'Inside',
      rect: { x: 20, y: 200, width: 200, height: 30 },
    },
    {
      ref: 'e4',
      index: 3,
      depth: 2,
      parentIndex: 1,
      type: 'android.widget.TextView',
      label: 'Clipped',
      rect: { x: 20, y: 700, width: 200, height: 30 },
    },
  ];

  assert.equal(isNodeVisibleInEffectiveViewport(nodes[2], nodes), true);
  assert.equal(isNodeVisibleInEffectiveViewport(nodes[3], nodes), false);
});

test('mobile presentation infers hidden content from vertical scroll indicator value at top', () => {
  const nodes: SnapshotNode[] = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'Window',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      ref: 'e2',
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'CollectionView',
      label: 'Vertical scroll bar, 2 pages',
      rect: { x: 0, y: 80, width: 390, height: 680 },
    },
    {
      ref: 'e3',
      index: 2,
      depth: 2,
      parentIndex: 1,
      type: 'Other',
      label: 'Vertical scroll bar, 2 pages',
      value: '0%',
      rect: { x: 360, y: 96, width: 20, height: 640 },
    },
  ];

  const presentation = buildMobileSnapshotPresentation(nodes);
  const container = presentation.nodes.find((node) => node.index === 1);
  assert.equal(container?.hiddenContentAbove, undefined);
  assert.equal(container?.hiddenContentBelow, true);
});

test('mobile presentation infers hidden content from vertical scroll indicator value in middle', () => {
  const nodes: SnapshotNode[] = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'Window',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      ref: 'e2',
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'CollectionView',
      label: 'Vertical scroll bar, 2 pages',
      rect: { x: 0, y: 80, width: 390, height: 680 },
    },
    {
      ref: 'e3',
      index: 2,
      depth: 2,
      parentIndex: 1,
      type: 'Other',
      label: 'Vertical scroll bar, 2 pages',
      value: '48%',
      rect: { x: 360, y: 96, width: 20, height: 640 },
    },
  ];

  const presentation = buildMobileSnapshotPresentation(nodes);
  const container = presentation.nodes.find((node) => node.index === 1);
  assert.equal(container?.hiddenContentAbove, true);
  assert.equal(container?.hiddenContentBelow, true);
});
