import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSnapshotDiffText } from '../output.ts';

test('formatSnapshotDiffText renders unified diff lines with summary', () => {
  const text = formatSnapshotDiffText({
    baselineInitialized: false,
    summary: { additions: 2, removals: 2, unchanged: 4 },
    lines: [
      { kind: 'unchanged', text: '@e0 [application]' },
      { kind: 'unchanged', text: '@e2 [window]' },
      { kind: 'removed', text: '  @e3 [other] "67"' },
      { kind: 'removed', text: '  @e4 [text] "67"' },
      { kind: 'added', text: '  @e3 [other] "134"' },
      { kind: 'added', text: '  @e4 [text] "134"' },
      { kind: 'unchanged', text: '  @e5 [button] "Increment"' },
      { kind: 'unchanged', text: '  @e6 [text] "Footer"' },
    ],
  });

  assert.doesNotMatch(text, /^@e0 \[application\]$/m);
  assert.match(text, /^@e2 \[window\]/m);
  assert.match(text, /^- @e3 \[other\] "67"$/m);
  assert.match(text, /^\+ @e3 \[other\] "134"$/m);
  assert.match(text, /^  @e5 \[button\] "Increment"$/m);
  assert.doesNotMatch(text, /^  @e6 \[text\] "Footer"$/m);
  assert.match(text, /2 additions, 2 removals, 4 unchanged/);
});

test('formatSnapshotDiffText renders baseline initialization text', () => {
  const text = formatSnapshotDiffText({
    baselineInitialized: true,
    summary: { additions: 0, removals: 0, unchanged: 5 },
    lines: [],
  });

  assert.match(text, /Baseline initialized \(5 lines\)\./);
  assert.doesNotMatch(text, /additions|removals|unchanged/);
});
