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

test('annotateAndroidScrollableContentHints infers bottomed-out scroll areas from a single aligned block', () => {
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
      rect: { x: 0, y: 432, width: 390, height: 168 },
      depth: 2,
      parentIndex: 1,
    },
  ];

  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,804 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,636-390,804 #3}',
  ].join('\n');

  annotateAndroidScrollableContentHints(nodes, dump);

  assert.equal(nodes[0].hiddenContentAbove, true);
  assert.equal(nodes[0].hiddenContentBelow, undefined);
});

test('annotateAndroidScrollableContentHints infers virtualized scroll coverage without a unique block offset', () => {
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
      rect: { x: 0, y: 100, width: 390, height: 143 },
      depth: 2,
      parentIndex: 1,
    },
    ...Array.from({ length: 11 }, (_value, index) => ({
      index: index + 3,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 243 + index * 192, width: 390, height: 192 },
      depth: 2,
      parentIndex: 1,
    })),
  ];

  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,853 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{a V.E...... ........ 0,285-390,477 #1}',
    '        com.facebook.react.views.view.ReactViewGroup{b V.E...... ........ 0,477-390,669 #2}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,669-390,861 #3}',
    '        com.facebook.react.views.view.ReactViewGroup{d V.E...... ........ 0,861-390,1053 #4}',
    '        com.facebook.react.views.view.ReactViewGroup{e V.E...... ........ 0,1053-390,1245 #5}',
    '        com.facebook.react.views.view.ReactViewGroup{f V.E...... ........ 0,1245-390,1437 #6}',
  ].join('\n');

  annotateAndroidScrollableContentHints(nodes, dump);

  assert.equal(nodes[0].hiddenContentAbove, true);
  assert.equal(nodes[0].hiddenContentBelow, true);
});

test('annotateAndroidScrollableContentHints keeps shallow offset matching for fully mounted content', () => {
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
      rect: { x: 0, y: 100, width: 390, height: 100 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 3,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 200, width: 390, height: 180 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 4,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 380, width: 390, height: 120 },
      depth: 2,
      parentIndex: 1,
    },
    {
      index: 5,
      type: 'android.view.ViewGroup',
      rect: { x: 0, y: 500, width: 390, height: 100 },
      depth: 2,
      parentIndex: 1,
    },
  ];

  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,520 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{a V.E...... ........ 0,20-390,120 #1}',
    '        com.facebook.react.views.view.ReactViewGroup{b V.E...... ........ 0,120-390,300 #2}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,300-390,420 #3}',
    '        com.facebook.react.views.view.ReactViewGroup{d V.E...... ........ 0,420-390,520 #4}',
  ].join('\n');

  annotateAndroidScrollableContentHints(nodes, dump);

  assert.equal(nodes[0].hiddenContentAbove, true);
  assert.equal(nodes[0].hiddenContentBelow, undefined);
});
