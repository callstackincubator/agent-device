import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { formatScreenshotDiffText, formatSnapshotDiffText, formatSnapshotText } from '../output.ts';

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
    }),
  );
  assert.match(text, /✗ 5% pixels differ/);
  assert.match(text, /Diff image:/);
  assert.match(text, /500 different \/ 10000 total pixels/);
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
