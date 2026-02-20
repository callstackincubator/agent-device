import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotDiff, snapshotNodeToComparableLine } from '../snapshot-diff.ts';
import { attachRefs, type RawSnapshotNode } from '../../utils/snapshot.ts';

function nodes(raw: RawSnapshotNode[]) {
  return attachRefs(raw);
}

test('snapshotNodeToComparableLine ignores volatile fields', () => {
  const [node] = nodes([{
    index: 0,
    type: 'XCUIElementTypeTextField',
    label: 'Email',
    value: 'test@example.com',
    identifier: 'email-input',
    depth: 1,
    rect: { x: 10, y: 20, width: 100, height: 20 },
  }]);
  assert.equal(
    snapshotNodeToComparableLine(node),
    '  textfield label="Email" value="test@example.com" id="email-input"',
  );
});

test('buildSnapshotDiff returns unchanged lines when snapshots match', () => {
  const previous = nodes([
    { index: 0, type: 'button', label: 'Submit', depth: 0 },
    { index: 1, type: 'text', label: 'Create account', depth: 1 },
  ]);
  const current = nodes([
    { index: 0, type: 'button', label: 'Submit', depth: 0 },
    { index: 1, type: 'text', label: 'Create account', depth: 1 },
  ]);
  const diff = buildSnapshotDiff(previous, current);
  assert.deepEqual(diff.summary, { additions: 0, removals: 0, unchanged: 2 });
  assert.equal(diff.lines.length, 2);
  assert.equal(diff.lines[0]?.kind, 'unchanged');
  assert.equal(diff.lines[1]?.kind, 'unchanged');
});

test('buildSnapshotDiff reports removals and additions for value changes', () => {
  const previous = nodes([
    { index: 0, type: 'textfield', label: 'Email', value: '', depth: 0 },
    { index: 1, type: 'button', label: 'Submit', depth: 0, enabled: true },
  ]);
  const current = nodes([
    { index: 0, type: 'textfield', label: 'Email', value: 'test@example.com', depth: 0 },
    { index: 1, type: 'button', label: 'Submit', depth: 0, enabled: false },
  ]);
  const diff = buildSnapshotDiff(previous, current);
  assert.deepEqual(diff.summary, { additions: 2, removals: 2, unchanged: 0 });
  assert.equal(diff.lines.length, 4);
  const removed = diff.lines.filter((line) => line.kind === 'removed');
  const added = diff.lines.filter((line) => line.kind === 'added');
  assert.equal(removed.length, 2);
  assert.equal(added.length, 2);
});

test('buildSnapshotDiff keeps stable order with unchanged context', () => {
  const previous = nodes([
    { index: 0, type: 'heading', label: 'Sign Up', depth: 0 },
    { index: 1, type: 'text', label: 'Create account', depth: 0 },
    { index: 2, type: 'button', label: 'Submit', depth: 0, enabled: true },
  ]);
  const current = nodes([
    { index: 0, type: 'heading', label: 'Sign Up', depth: 0 },
    { index: 1, type: 'text', label: 'Create account', depth: 0 },
    { index: 2, type: 'status', label: 'Sending...', depth: 0 },
    { index: 3, type: 'button', label: 'Submit', depth: 0, enabled: false },
  ]);
  const diff = buildSnapshotDiff(previous, current);
  assert.deepEqual(diff.summary, { additions: 2, removals: 1, unchanged: 2 });
  const kinds = diff.lines.map((line) => line.kind);
  assert.equal(kinds[0], 'unchanged');
  assert.equal(kinds[1], 'unchanged');
  assert.equal(diff.lines.filter((line) => line.kind === 'added').length, 2);
  assert.equal(diff.lines.filter((line) => line.kind === 'removed').length, 1);
});

test('buildSnapshotDiff uses linear fallback for very large snapshots', () => {
  const previousRaw: RawSnapshotNode[] = [];
  const currentRaw: RawSnapshotNode[] = [];
  for (let index = 0; index < 2_100; index += 1) {
    previousRaw.push({ index, type: 'text', label: `row-${index}`, depth: 0 });
    currentRaw.push({ index, type: 'text', label: `row-${index}`, depth: 0 });
  }
  // Change one line so we still exercise add/remove behavior while crossing fallback threshold.
  currentRaw[1_050] = { index: 1_050, type: 'text', label: 'row-1050-updated', depth: 0 };
  const diff = buildSnapshotDiff(nodes(previousRaw), nodes(currentRaw));
  assert.equal(diff.summary.additions, 1);
  assert.equal(diff.summary.removals, 1);
  assert.equal(diff.summary.unchanged, 2_099);
});
