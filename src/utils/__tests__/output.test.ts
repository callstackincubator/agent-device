import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSnapshotDiffText } from '../output.ts';

test('formatSnapshotDiffText renders baseline initialized response', () => {
  const text = formatSnapshotDiffText({
    mode: 'snapshot',
    baselineInitialized: true,
    summary: { additions: 0, removals: 0, unchanged: 4 },
    lines: [],
  });
  assert.match(text, /Diff \(snapshot\): baseline initialized/);
  assert.match(text, /Run diff snapshot again after UI changes\./);
  assert.match(text, /0 additions, 0 removals, 4 unchanged/);
});

test('formatSnapshotDiffText renders unified-style diff lines', () => {
  const text = formatSnapshotDiffText({
    mode: 'snapshot',
    baselineInitialized: false,
    summary: { additions: 2, removals: 1, unchanged: 2 },
    lines: [
      { kind: 'unchanged', text: 'heading label="Sign Up"' },
      { kind: 'removed', text: 'button label="Submit"' },
      { kind: 'added', text: 'button label="Submit" disabled' },
      { kind: 'added', text: 'status label="Sending..."' },
    ],
  });
  assert.match(text, /^Diff \(snapshot\)\n/);
  assert.match(text, /\nheading label="Sign Up"\n/);
  assert.match(text, /\n- button label="Submit"\n/);
  assert.match(text, /\n\+ button label="Submit" disabled\n/);
  assert.match(text, /\n\+ status label="Sending\.\.\."\n/);
  assert.match(text, /2 additions, 1 removals, 2 unchanged/);
});
