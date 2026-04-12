import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { formatScreenshotDiffText, formatSnapshotDiffText, formatSnapshotText } from '../output.ts';
import { formatSnapshotLine } from '../snapshot-lines.ts';

const DIFF_DATA = {
  mode: 'snapshot',
  baselineInitialized: false,
  summary: { additions: 1, removals: 1, unchanged: 1 },
  lines: [
    { kind: 'unchanged', text: '@e2 [window]' },
    { kind: 'removed', text: '  @e3 [text] "67"' },
    { kind: 'added', text: '  @e3 [text] "134"' },
  ],
} as const;

test('formatSnapshotDiffText renders plain text when color is disabled', () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  process.env.FORCE_COLOR = '0';
  delete process.env.NO_COLOR;
  try {
    const text = formatSnapshotDiffText({ ...DIFF_DATA });
    assert.match(text, /^@e2 \[window\]/m);
    assert.match(text, /^-  @e3 \[text\] "67"$/m);
    assert.match(text, /^\+  @e3 \[text\] "134"$/m);
    assert.match(text, /1 additions, 1 removals, 1 unchanged/);
    assert.equal(text.includes('\x1b['), false);
  } finally {
    if (typeof originalForceColor === 'string') process.env.FORCE_COLOR = originalForceColor;
    else delete process.env.FORCE_COLOR;
    if (typeof originalNoColor === 'string') process.env.NO_COLOR = originalNoColor;
    else delete process.env.NO_COLOR;
  }
});

test('formatSnapshotDiffText renders ANSI colors when forced', () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  try {
    const text = formatSnapshotDiffText({ ...DIFF_DATA });
    const plainText = stripVTControlCharacters(text);
    assert.notEqual(text, plainText);
    assert.match(plainText, /^@e2 \[window\]/m);
    assert.match(plainText, /^-  @e3 \[text\] "67"$/m);
    assert.match(plainText, /^\+  @e3 \[text\] "134"$/m);
    assert.match(plainText, /1 additions, 1 removals, 1 unchanged/);
  } finally {
    if (typeof originalForceColor === 'string') process.env.FORCE_COLOR = originalForceColor;
    else delete process.env.FORCE_COLOR;
    if (typeof originalNoColor === 'string') process.env.NO_COLOR = originalNoColor;
    else delete process.env.NO_COLOR;
  }
});

test('formatSnapshotDiffText prints warnings before the diff body', () => {
  const text = withNoColor(() =>
    formatSnapshotDiffText({
      ...DIFF_DATA,
      warnings: ['Recent press was followed by a nearly identical snapshot.'],
    }),
  );
  assert.match(text, /^Recent press was followed by a nearly identical snapshot\.$/m);
  assert.match(text, /^@e2 \[window\]$/m);
  assert.match(text, /1 additions, 1 removals, 1 unchanged/);
});

test('formatSnapshotText summarizes large text surfaces with preview metadata', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
        {
          ref: 'e1',
          index: 0,
          depth: 0,
          type: 'TextView',
          label: 'Editor for MainActivity.kt',
          value: 'package com.example.app\nclass MainActivity {}',
          enabled: true,
        },
      ],
      truncated: false,
    }),
  );
  assert.match(text, /@e1 \[text-view\] "Editor for MainActivity\.kt"/);
  assert.match(text, /\[editable\]/);
  assert.match(text, /\[preview:"package com\.example\.app class MainActivity \{\}"\]/);
  assert.match(text, /\[truncated\]/);
});

test('formatSnapshotText summarizes large Android TextView surfaces with preview metadata', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
        {
          ref: 'e1',
          index: 0,
          depth: 0,
          type: 'android.widget.TextView',
          label: 'line one\nline two\nline three',
          value: 'line one\nline two\nline three',
          enabled: true,
        },
      ],
      truncated: false,
    }),
  );
  assert.match(text, /@e1 \[text\] "Text view"/);
  assert.match(text, /\[preview:"line one line two line three"\]/);
  assert.match(text, /\[truncated\]/);
});

test('formatSnapshotText omits unlabeled group wrappers while preserving labeled groups', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
        { ref: 'e1', index: 0, depth: 0, type: 'android.widget.FrameLayout' },
        { ref: 'e2', index: 1, depth: 1, parentIndex: 0, type: 'android.widget.LinearLayout' },
        { ref: 'e3', index: 2, depth: 2, parentIndex: 1, type: 'android.view.ViewGroup' },
        {
          ref: 'e14',
          index: 3,
          depth: 3,
          parentIndex: 2,
          type: 'android.widget.ScrollView',
        },
        {
          ref: 'e17',
          index: 4,
          depth: 4,
          parentIndex: 3,
          type: 'android.view.ViewGroup',
          label: 'HomePage',
        },
        {
          ref: 'e21',
          index: 5,
          depth: 5,
          parentIndex: 4,
          type: 'android.view.ViewGroup',
          label: 'Home',
        },
        {
          ref: 'e22',
          index: 6,
          depth: 5,
          parentIndex: 4,
          type: 'android.widget.Button',
          label: 'Search',
        },
      ],
      truncated: false,
    }),
  );

  assert.doesNotMatch(text, /@e1 \[group\]/);
  assert.doesNotMatch(text, /@e2 \[group\]/);
  assert.doesNotMatch(text, /@e3 \[group\]/);
  assert.match(text, /@e14 \[scroll-area\] \[scrollable\]/);
  assert.match(text, /  @e17 \[group\] "HomePage"/);
  assert.match(text, /    @e21 \[group\] "Home"/);
  assert.match(text, /    @e22 \[button\] "Search"/);
});

test('formatSnapshotText compresses visible indentation after hidden wrapper chains', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
        { ref: 'e1', index: 0, depth: 0, type: 'android.widget.FrameLayout' },
        { ref: 'e2', index: 1, depth: 1, parentIndex: 0, type: 'android.widget.ScrollView' },
        {
          ref: 'e3',
          index: 2,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'Back',
        },
        { ref: 'e4', index: 3, depth: 3, parentIndex: 2, type: 'android.view.ViewGroup' },
        { ref: 'e5', index: 4, depth: 4, parentIndex: 3, type: 'android.widget.ImageView' },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /^@e2 \[scroll-area\] \[scrollable\]$/m);
  assert.match(text, /^  @e3 \[button\] "Back"$/m);
  assert.match(text, /^    @e5 \[image\]$/m);
});

test('formatSnapshotText hides off-screen refs and adds compact discovery summaries', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
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
          label: 'Settings',
          rect: { x: 20, y: 120, width: 120, height: 44 },
          hittable: true,
        },
        {
          ref: 'e3',
          index: 2,
          depth: 1,
          parentIndex: 0,
          type: 'XCUIElementTypeButton',
          label: 'Privacy',
          rect: { x: 20, y: 1200, width: 120, height: 44 },
          hittable: true,
        },
        {
          ref: 'e4',
          index: 3,
          depth: 1,
          parentIndex: 0,
          type: 'XCUIElementTypeButton',
          label: 'Battery',
          rect: { x: 20, y: 1360, width: 120, height: 44 },
          hittable: true,
        },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /Snapshot: 2 visible nodes \(4 total\)/);
  assert.match(text, /^@e1 \[window\]$/m);
  assert.match(text, /^  @e2 \[button\] "Settings"$/m);
  assert.doesNotMatch(text, /@e3 \[button\] "Privacy"/);
  assert.doesNotMatch(text, /@e4 \[button\] "Battery"/);
  assert.match(text, /\[off-screen below\] 2 interactive items: "Privacy", "Battery"/);
});

test('formatSnapshotText keeps zero-height visible nodes out of off-screen summaries', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
        {
          ref: 'e1',
          index: 0,
          depth: 0,
          type: 'Window',
          rect: { x: 0, y: 0, width: 1440, height: 800 },
        },
        {
          ref: 'e2',
          index: 1,
          depth: 1,
          parentIndex: 0,
          type: 'android.widget.FrameLayout',
          rect: { x: 0, y: 0, width: 1440, height: 3120 },
        },
        {
          ref: 'e3',
          index: 2,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'View',
          rect: { x: 264, y: 378, width: 972, height: 0 },
          hittable: true,
        },
        {
          ref: 'e4',
          index: 3,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'Later',
          rect: { x: 264, y: 2200, width: 972, height: 120 },
          hittable: true,
        },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /^  @e3 \[button\] "View"$/m);
  assert.doesNotMatch(text, /\[off-screen above\].*"View"/);
  assert.match(text, /\[off-screen below\] 1 interactive item: "Later"/);
});

test('formatSnapshotText renders explicit hidden scroll-area content hints', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
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
          rect: { x: 0, y: 120, width: 390, height: 500 },
          hiddenContentAbove: true,
          hiddenContentBelow: true,
        },
        {
          ref: 'e3',
          index: 2,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'Visible message',
          rect: { x: 20, y: 240, width: 350, height: 48 },
          hittable: true,
        },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /Snapshot: 3 visible nodes/);
  assert.match(text, /^  @e2 \[scroll-area\] "Messages" \[scrollable\]$/m);
  assert.match(text, /^    \[content above scroll-area hidden\]$/m);
  assert.match(text, /^    \[content below scroll-area hidden\]$/m);
});

test('formatSnapshotText prefers payload visibility metadata for partial snapshot headers', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
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
          type: 'android.widget.Button',
          label: 'Visible',
          rect: { x: 20, y: 140, width: 160, height: 44 },
          hittable: true,
        },
      ],
      visibility: {
        partial: true,
        visibleNodeCount: 2,
        totalNodeCount: 5,
        reasons: ['offscreen-nodes'],
      },
      truncated: false,
    }),
  );

  assert.match(text, /Snapshot: 2 visible nodes \(5 total\)/);
});

test('formatSnapshotText renders hidden scroll-area content hints in flattened output', () => {
  const text = withNoColor(() =>
    formatSnapshotText(
      {
        nodes: [
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
            rect: { x: 0, y: 120, width: 390, height: 500 },
            hiddenContentAbove: true,
            hiddenContentBelow: true,
          },
        ],
        truncated: false,
      },
      { flatten: true },
    ),
  );

  assert.match(text, /^@e2 \[scroll-area\] "Messages" \[scrollable\]$/m);
  assert.match(text, /^  \[content above scroll-area hidden\]$/m);
  assert.match(text, /^  \[content below scroll-area hidden\]$/m);
});

test('formatSnapshotText normalizes RecyclerView containers to list', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
        {
          ref: 'e1',
          index: 0,
          depth: 0,
          type: 'androidx.recyclerview.widget.RecyclerView',
          identifier: 'com.android.settings:id/recycler_view',
          rect: { x: 0, y: 0, width: 390, height: 500 },
          hiddenContentBelow: true,
        },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /^@e1 \[list\]$/m);
  assert.match(text, /^  \[content below list hidden\]$/m);
});

test('formatSnapshotText marks visible scroll areas with hidden content above and below', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
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
          rect: { x: 0, y: 120, width: 390, height: 500 },
        },
        {
          ref: 'e3',
          index: 2,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'Earlier message',
          rect: { x: 20, y: 20, width: 350, height: 48 },
          hittable: true,
        },
        {
          ref: 'e4',
          index: 3,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'Visible message',
          rect: { x: 20, y: 240, width: 350, height: 48 },
          hittable: true,
        },
        {
          ref: 'e5',
          index: 4,
          depth: 2,
          parentIndex: 1,
          type: 'android.widget.Button',
          label: 'Later message',
          rect: { x: 20, y: 700, width: 350, height: 48 },
          hittable: true,
        },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /^  @e2 \[scroll-area\] "Messages" \[scrollable\]$/m);
  assert.match(text, /^    \[content above scroll-area hidden\]$/m);
  assert.match(text, /^    \[content below scroll-area hidden\]$/m);
  assert.match(text, /^    @e4 \[button\] "Visible message"$/m);
  assert.doesNotMatch(text, /\[off-screen above\].*"Earlier message"/);
  assert.doesNotMatch(text, /\[off-screen below\].*"Later message"/);
});

test('formatSnapshotText suppresses noisy system scroll-container labels', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [
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
          type: 'ScrollView',
          label: 'Vertical scroll bar, 2 pages',
          rect: { x: 0, y: 100, width: 390, height: 600 },
          hiddenContentBelow: true,
        },
      ],
      truncated: false,
    }),
  );

  assert.match(text, /^  @e2 \[scroll-area\] \[scrollable\]$/m);
  assert.match(text, /^    \[content below scroll-area hidden\]$/m);
  assert.doesNotMatch(text, /Vertical scroll bar, 2 pages/);
});

test('formatSnapshotText prints snapshot warnings ahead of empty output', () => {
  const text = withNoColor(() =>
    formatSnapshotText({
      nodes: [],
      truncated: false,
      warnings: ['Interactive snapshot is empty after filtering 42 raw Android nodes.'],
    }),
  );
  assert.match(text, /Snapshot: 0 nodes/);
  assert.match(text, /Interactive snapshot is empty after filtering 42 raw Android nodes/);
});

test('formatSnapshotText keeps flattened output and adds duplicate nav warning', () => {
  const nodes = Array.from({ length: 24 }, (_, index) => ({
    ref: `e${index + 1}`,
    index,
    depth: index === 0 ? 0 : 1,
    type: index === 0 ? 'android.widget.FrameLayout' : 'android.widget.Button',
    label: index === 0 ? 'Root' : 'Inbox',
    rect:
      index === 0
        ? { x: 0, y: 0, width: 1080, height: 2400 }
        : { x: 20, y: 40 + index * 80, width: 300, height: 48 },
    hittable: index !== 0,
    enabled: true,
  }));
  const text = withNoColor(() =>
    formatSnapshotText({ nodes, truncated: false }, { flatten: true }),
  );
  assert.match(text, /Warning: possible repeated nav subtree detected\./);
  assert.match(text, /@e2 \[button\] "Inbox"/);
});

test('detectPossibleRepeatedNavSubtree does not warn for small trees', () => {
  // 19 nodes (below the 20-node floor) — even if all are duplicates, no warning
  const nodes = Array.from({ length: 19 }, (_, index) => ({
    ref: `e${index + 1}`,
    index,
    depth: index === 0 ? 0 : 1,
    type: 'android.widget.Button',
    label: 'Inbox',
    rect: { x: 20, y: 40 + index * 80, width: 300, height: 48 },
    hittable: true,
    enabled: true,
  }));
  const text = withNoColor(() =>
    formatSnapshotText({ nodes, truncated: false }, { flatten: true }),
  );
  assert.doesNotMatch(text, /Warning: possible repeated nav subtree detected\./);
});

test('detectPossibleRepeatedNavSubtree does not warn when duplicates are below threshold', () => {
  // 20 nodes but only 6 share a signature (below the 8 cumulative threshold)
  const nodes = Array.from({ length: 20 }, (_, index) => ({
    ref: `e${index + 1}`,
    index,
    depth: index === 0 ? 0 : 1,
    type: 'android.widget.Button',
    label: index < 7 ? `Unique${index}` : index < 10 ? 'Shared' : `Other${index}`,
    rect: { x: 20, y: 40 + index * 80, width: 300, height: 48 },
    hittable: true,
    enabled: true,
  }));
  const text = withNoColor(() =>
    formatSnapshotText({ nodes, truncated: false }, { flatten: true }),
  );
  assert.doesNotMatch(text, /Warning: possible repeated nav subtree detected\./);
});

test('formatSnapshotLine keeps snapshot-only metadata off the default formatter path', () => {
  const line = formatSnapshotLine(
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'TextView',
      label: 'Editor for MainActivity.kt',
      value: 'package com.example.app\nclass MainActivity {}',
      enabled: true,
      selected: true,
    },
    0,
    false,
  );
  assert.doesNotMatch(line, /\[selected\]/);
  assert.doesNotMatch(line, /\[editable\]/);
  assert.doesNotMatch(line, /\[scrollable\]/);
});

function withNoColor<T>(fn: () => T): T {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  process.env.FORCE_COLOR = '0';
  delete process.env.NO_COLOR;
  try {
    return fn();
  } finally {
    if (typeof originalForceColor === 'string') process.env.FORCE_COLOR = originalForceColor;
    else delete process.env.FORCE_COLOR;
    if (typeof originalNoColor === 'string') process.env.NO_COLOR = originalNoColor;
    else delete process.env.NO_COLOR;
  }
}

function withColor<T>(fn: () => T): T {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  try {
    return fn();
  } finally {
    if (typeof originalForceColor === 'string') process.env.FORCE_COLOR = originalForceColor;
    else delete process.env.FORCE_COLOR;
    if (typeof originalNoColor === 'string') process.env.NO_COLOR = originalNoColor;
    else delete process.env.NO_COLOR;
  }
}

test('formatScreenshotDiffText renders match success without color', () => {
  const text = withNoColor(() =>
    formatScreenshotDiffText({
      match: true,
      differentPixels: 0,
      totalPixels: 100,
      mismatchPercentage: 0,
    }),
  );
  assert.match(text, /✓ Screenshots match\./);
  assert.equal(text.includes('\x1b['), false);
});

test('formatScreenshotDiffText renders mismatch with pixel counts without color', () => {
  const text = withNoColor(() =>
    formatScreenshotDiffText({
      match: false,
      differentPixels: 500,
      totalPixels: 10000,
      mismatchPercentage: 5,
      diffPath: '/tmp/test/diff.png',
      currentOverlayPath: '/tmp/test/diff.current-overlay.png',
      currentOverlayRefCount: 1,
      regions: [
        {
          index: 1,
          rect: { x: 10, y: 20, width: 100, height: 40 },
          normalizedRect: { x: 10, y: 20, width: 100, height: 40 },
          differentPixels: 350,
          shareOfDiffPercentage: 70,
          densityPercentage: 8.75,
          shape: 'horizontal-band',
          size: 'medium',
          location: 'top-left',
          averageBaselineColorHex: '#141414',
          averageCurrentColorHex: '#dcdcdc',
          baselineLuminance: 20,
          currentLuminance: 220,
          dominantChange: 'brighter',
          currentOverlayMatches: [
            {
              ref: 'e1',
              label: 'Continue',
              rect: { x: 1, y: 2, width: 3, height: 4 },
              regionCoveragePercentage: 12,
            },
          ],
        },
      ],
      ocr: {
        provider: 'tesseract',
        baselineBlocks: 2,
        currentBlocks: 2,
        matches: [
          {
            text: 'Wi-Fi',
            baselineRect: { x: 120, y: 320, width: 60, height: 22 },
            currentRect: { x: 130, y: 332, width: 70, height: 22 },
            delta: { x: 10, y: 12, width: 10, height: 0 },
            confidence: 94,
            widthRatio: 1.167,
            heightRatio: 1,
            possibleTextMetricMismatch: true,
          },
        ],
      },
      nonTextDeltas: [
        {
          index: 1,
          regionIndex: 1,
          slot: 'leading',
          likelyKind: 'icon',
          rect: { x: 80, y: 318, width: 30, height: 30 },
          nearestText: 'Wi-Fi',
        },
      ],
    }),
  );
  assert.match(text, /✗ 5% pixels differ/);
  assert.match(text, /Diff image:/);
  assert.match(text, /Current overlay:/);
  assert.match(text, /diff\.current-overlay\.png \(1 refs\)/);
  assert.match(text, /500 different \/ 10000 total pixels/);
  assert.match(text, /Changed regions:/);
  assert.match(text, /1\. top-left x=10 y=20 100x40, 70% of diff, current is brighter/);
  assert.match(
    text,
    /size=medium shape=horizontal-band density=8\.75% boundsPct=10,20,100,40 avgColor=#141414->#dcdcdc luminance=20->220/,
  );
  assert.match(text, /overlaps @e1 "Continue", 12% of region/);
  assert.match(
    text,
    /OCR text deltas \(tesseract; baselineBlocks=2 currentBlocks=2; showing 1\/1; px\):/,
  );
  assert.match(
    text,
    /item \| text \| movePx \| sizeDeltaPx \| bboxBaseline \| bboxCurrent \| textRatio \| confidence \| issueHint/,
  );
  assert.match(
    text,
    /1 \| "Wi-Fi" \| \+10,\+12 \| \+10,0 \| x=120,y=320,w=60,h=22 \| x=130,y=332,w=70,h=22 \| w=1\.167 h=1 \| 94 \| possible-text-metric-mismatch/,
  );
  assert.match(text, /Non-text visual deltas \(showing 1\/1; px\):/);
  assert.match(text, /item \| region \| slot \| kind \| bboxCurrent \| nearestText/);
  assert.match(text, /1 \| r1 \| leading \| icon \| x=80,y=318,w=30,h=30 \| "Wi-Fi"/);
  assert.equal(text.includes('\x1b['), false);
});

test('formatScreenshotDiffText renders dimension mismatch', () => {
  const text = withNoColor(() =>
    formatScreenshotDiffText({
      match: false,
      differentPixels: 100,
      totalPixels: 100,
      mismatchPercentage: 100,
      dimensionMismatch: {
        expected: { width: 1170, height: 2532 },
        actual: { width: 1080, height: 1920 },
      },
    }),
  );
  assert.match(text, /✗ Screenshots have different dimensions/);
  assert.match(text, /expected 1170x2532/);
  assert.match(text, /got 1080x1920/);
  assert.equal(text.includes('different /'), false);
});

test('formatScreenshotDiffText renders diff path relative to cwd', () => {
  const cwd = process.cwd();
  const text = withNoColor(() =>
    formatScreenshotDiffText({
      match: false,
      differentPixels: 10,
      totalPixels: 100,
      mismatchPercentage: 10,
      diffPath: `${cwd}/diff.png`,
    }),
  );
  assert.match(text, /\.\/diff\.png/);
  assert.equal(text.includes(cwd), false);
});

test('formatScreenshotDiffText keeps absolute diff path outside cwd', () => {
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);
  const siblingDir = path.join(parentDir, `${path.basename(cwd)}-sibling`);
  const diffPath = path.join(siblingDir, 'diff.png');
  const text = withNoColor(() =>
    formatScreenshotDiffText({
      match: false,
      differentPixels: 10,
      totalPixels: 100,
      mismatchPercentage: 10,
      diffPath,
    }),
  );
  assert.match(text, new RegExp(diffPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(text.includes('./'), false);
});

test('formatScreenshotDiffText uses ANSI colors when enabled', () => {
  const text = withColor(() =>
    formatScreenshotDiffText({
      match: false,
      differentPixels: 10,
      totalPixels: 100,
      mismatchPercentage: 10,
      diffPath: '/tmp/diff.png',
    }),
  );
  assert.equal(text.includes('\x1b[31m'), true);
  assert.equal(text.includes('\x1b[32m'), true);
  assert.equal(text.includes('\x1b[2m'), true);
});

test('formatScreenshotDiffText does not show diff path when images match', () => {
  const text = withNoColor(() =>
    formatScreenshotDiffText({
      match: true,
      differentPixels: 0,
      totalPixels: 100,
      mismatchPercentage: 0,
      diffPath: '/tmp/diff.png',
    }),
  );
  assert.equal(text.includes('Diff image'), false);
  assert.equal(text.includes('diff.png'), false);
});
