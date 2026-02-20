import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRefs, type RawSnapshotNode } from '../../utils/snapshot.ts';
import { buildSnapshotDiff } from '../snapshot-diff.ts';

function nodes(raw: RawSnapshotNode[]) {
  return attachRefs(raw);
}

test('buildSnapshotDiff reports unchanged lines when snapshots are equal', () => {
  const previous = nodes([
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
    { index: 1, depth: 1, type: 'XCUIElementTypeButton', label: 'Increment' },
  ]);
  const current = nodes([
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
    { index: 1, depth: 1, type: 'XCUIElementTypeButton', label: 'Increment' },
  ]);

  const diff = buildSnapshotDiff(previous, current);
  assert.equal(diff.summary.additions, 0);
  assert.equal(diff.summary.removals, 0);
  assert.equal(diff.summary.unchanged, 2);
  assert.deepEqual(diff.lines.map((line) => line.kind), ['unchanged', 'unchanged']);
});

test('buildSnapshotDiff reports added and removed lines', () => {
  const previous = nodes([
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
    { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: '67' },
    { index: 2, depth: 1, type: 'XCUIElementTypeButton', label: 'Increment' },
  ]);
  const current = nodes([
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
    { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: '134' },
    { index: 2, depth: 1, type: 'XCUIElementTypeButton', label: 'Increment' },
  ]);

  const diff = buildSnapshotDiff(previous, current);
  assert.equal(diff.summary.additions, 1);
  assert.equal(diff.summary.removals, 1);
  assert.equal(diff.summary.unchanged, 2);
  assert.deepEqual(diff.lines.map((line) => line.kind), ['unchanged', 'removed', 'added', 'unchanged']);
});

test('buildSnapshotDiff treats value changes as remove plus add', () => {
  const previous = nodes([{ index: 0, depth: 0, type: 'XCUIElementTypeTextField', label: 'Amount', value: '67' }]);
  const current = nodes([{ index: 0, depth: 0, type: 'XCUIElementTypeTextField', label: 'Amount', value: '134' }]);

  const diff = buildSnapshotDiff(previous, current);
  assert.equal(diff.summary.additions, 1);
  assert.equal(diff.summary.removals, 1);
  assert.equal(diff.summary.unchanged, 0);
  assert.deepEqual(diff.lines.map((line) => line.kind), ['removed', 'added']);
});

test('buildSnapshotDiff preserves surrounding context ordering', () => {
  const previous = nodes([
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
    { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: 'Count' },
    { index: 2, depth: 1, type: 'XCUIElementTypeStaticText', label: '67' },
    { index: 3, depth: 1, type: 'XCUIElementTypeButton', label: 'Increment' },
  ]);
  const current = nodes([
    { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
    { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: 'Count' },
    { index: 2, depth: 1, type: 'XCUIElementTypeStaticText', label: '134' },
    { index: 3, depth: 1, type: 'XCUIElementTypeButton', label: 'Increment' },
  ]);

  const diff = buildSnapshotDiff(previous, current);
  assert.equal(diff.lines[0]?.kind, 'unchanged');
  assert.equal(diff.lines[1]?.kind, 'unchanged');
  assert.equal(diff.lines[2]?.kind, 'removed');
  assert.equal(diff.lines[3]?.kind, 'added');
  assert.equal(diff.lines[4]?.kind, 'unchanged');
});
