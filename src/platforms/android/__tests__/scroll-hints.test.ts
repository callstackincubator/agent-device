import { test } from 'vitest';
import assert from 'node:assert/strict';
import { annotateAndroidScrollableContentHints } from '../scroll-hints.ts';
import type { RawSnapshotNode } from '../../../utils/snapshot.ts';

test('annotateAndroidScrollableContentHints marks vertical scroll areas with hidden content above and below', () => {
  const nodes: RawSnapshotNode[] = [
    {
      index: 0,
      type: 'android.widget.ScrollView',
      label: 'Messages',
      rect: { x: 0, y: 100, width: 390, height: 500 },
      depth: 0,
    },
    {
      index: 1,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 100, width: 390, height: 500 },
      depth: 1,
      parentIndex: 0,
    },
    {
      index: 2,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 100, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 3,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 268, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 4,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 436, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
  ];

  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,1000 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{a V.E...... ........ 0,300-390,468 #1}',
    '        com.facebook.react.views.view.ReactViewGroup{b V.E...... ........ 0,468-390,636 #2}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,636-390,804 #3}',
  ].join('\n');

  annotateAndroidScrollableContentHints(nodes, dump);

  assert.equal(nodes[0].hiddenContentAbove, true);
  assert.equal(nodes[0].hiddenContentBelow, true);
});

test('annotateAndroidScrollableContentHints marks bottomed-out scroll areas without hidden content below', () => {
  const nodes: RawSnapshotNode[] = [
    {
      index: 0,
      type: 'android.widget.ScrollView',
      label: 'Messages',
      rect: { x: 0, y: 100, width: 390, height: 500 },
      depth: 0,
    },
    {
      index: 1,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 100, width: 390, height: 500 },
      depth: 1,
      parentIndex: 0,
    },
    {
      index: 2,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 100, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 3,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 268, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 4,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 436, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
  ];

  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,804 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{a V.E...... ........ 0,304-390,472 #1}',
    '        com.facebook.react.views.view.ReactViewGroup{b V.E...... ........ 0,472-390,640 #2}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,640-390,804 #3}',
  ].join('\n');

  annotateAndroidScrollableContentHints(nodes, dump);

  assert.equal(nodes[0].hiddenContentAbove, true);
  assert.equal(nodes[0].hiddenContentBelow, undefined);
});
