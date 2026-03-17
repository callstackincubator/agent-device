import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { formatSnapshotDiffText } from '../output.ts';

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
