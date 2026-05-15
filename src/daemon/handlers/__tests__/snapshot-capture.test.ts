import { expect, test } from 'vitest';
import { buildSnapshotState, buildSnapshotVisibility } from '../snapshot-capture.ts';

test('buildSnapshotState handles undefined nodes gracefully', () => {
  const state = buildSnapshotState({ nodes: undefined, truncated: undefined }, undefined);
  expect(state.nodes).toEqual([]);
  expect(state.truncated).toBeUndefined();
  expect(state.createdAt).toBeGreaterThan(0);
});

test('buildSnapshotState handles completely empty data object', () => {
  const state = buildSnapshotState({}, undefined);
  expect(state.nodes).toEqual([]);
  expect(state.truncated).toBeUndefined();
});

test('buildSnapshotState handles nodes with missing fields', () => {
  const state = buildSnapshotState(
    {
      nodes: [
        { index: 0 } as any,
        { index: 1, depth: undefined, type: undefined, label: undefined } as any,
      ],
      truncated: false,
      backend: 'android',
    },
    undefined,
  );
  expect(state.nodes).toHaveLength(2);
  expect(state.nodes[0]?.ref).toBeTruthy();
  expect(state.nodes[1]?.ref).toBeTruthy();
});

test('buildSnapshotState marks comparisonSafe false for filtered Android snapshots', () => {
  const nodes = [{ index: 0, depth: 0, type: 'android.widget.TextView', label: 'A' }];

  const interactiveOnly = buildSnapshotState(
    { nodes, backend: 'android' },
    { snapshotInteractiveOnly: true },
  );
  expect(interactiveOnly.comparisonSafe).toBe(false);

  const compact = buildSnapshotState({ nodes, backend: 'android' }, { snapshotCompact: true });
  expect(compact.comparisonSafe).toBe(false);

  const withDepth = buildSnapshotState({ nodes, backend: 'android' }, { snapshotDepth: 2 });
  expect(withDepth.comparisonSafe).toBe(false);

  const withScope = buildSnapshotState({ nodes, backend: 'android' }, { snapshotScope: 'Header' });
  expect(withScope.comparisonSafe).toBe(false);

  const unfiltered = buildSnapshotState({ nodes, backend: 'android' }, {});
  expect(unfiltered.comparisonSafe).toBe(true);
});

test('buildSnapshotState marks comparisonSafe false for non-Android backends', () => {
  const nodes = [{ index: 0, depth: 0, type: 'Button', label: 'OK' }];
  const state = buildSnapshotState({ nodes, backend: 'xctest' }, {});
  expect(state.comparisonSafe).toBe(false);
});

test('buildSnapshotState returns empty nodes when scoped snapshot has no label match', () => {
  const nodes = [
    { index: 0, depth: 0, type: 'Window', label: 'Root' },
    { index: 1, depth: 1, type: 'Button', label: 'Search' },
  ];

  const state = buildSnapshotState(
    { nodes, backend: 'xctest' },
    { snapshotScope: 'zzzz-no-match-token' },
  );

  expect(state.nodes).toEqual([]);
});

test('buildSnapshotVisibility returns non-partial for empty node list', () => {
  const vis = buildSnapshotVisibility({ nodes: [], backend: 'android' });
  expect(vis.partial).toBe(false);
  expect(vis.visibleNodeCount).toBe(0);
  expect(vis.totalNodeCount).toBe(0);
  expect(vis.reasons).toEqual([]);
});

test('buildSnapshotVisibility skips semantic analysis for raw snapshots', () => {
  const nodes = [
    { ref: 'e1', index: 0, depth: 0, type: 'View', label: 'Root', hiddenContentBelow: true },
  ];
  const vis = buildSnapshotVisibility({ nodes, backend: 'android', snapshotRaw: true });
  expect(vis.partial).toBe(false);
  expect(vis.visibleNodeCount).toBe(1);
  expect(vis.totalNodeCount).toBe(1);
  expect(vis.reasons).toEqual([]);
});

test('buildSnapshotVisibility skips semantic analysis for macos-helper backend', () => {
  const nodes = [{ ref: 'e1', index: 0, depth: 0, type: 'AXButton', label: 'Click Me' }];
  const vis = buildSnapshotVisibility({ nodes, backend: 'macos-helper' });
  expect(vis.partial).toBe(false);
  expect(vis.reasons).toEqual([]);
});

test('buildSnapshotVisibility detects scroll-hidden-above and scroll-hidden-below', () => {
  const nodes = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'ScrollView',
      label: 'Feed',
      hiddenContentAbove: true,
      hiddenContentBelow: true,
    },
  ];
  const vis = buildSnapshotVisibility({ nodes, backend: 'android' });
  expect(vis.partial).toBe(true);
  expect(vis.reasons).toContain('scroll-hidden-above');
  expect(vis.reasons).toContain('scroll-hidden-below');
});

test('buildSnapshotVisibility handles nodes with no scroll hints as non-partial', () => {
  const nodes = [
    { ref: 'e1', index: 0, depth: 0, type: 'Button', label: 'OK', hittable: true },
    { ref: 'e2', index: 1, depth: 0, type: 'Button', label: 'Cancel', hittable: true },
  ];
  const vis = buildSnapshotVisibility({ nodes, backend: 'xctest' });
  expect(vis.partial).toBe(false);
  expect(vis.visibleNodeCount).toBe(2);
  expect(vis.totalNodeCount).toBe(2);
  expect(vis.reasons).toEqual([]);
});
