import { test, expect } from 'vitest';
import type { SnapshotState } from '../../../utils/snapshot.ts';
import {
  resolveMaestroNodeFromSnapshot,
  resolveVisibleMaestroNodeFromSnapshot,
} from '../runtime-targets.ts';

test('resolveVisibleMaestroNodeFromSnapshot treats app content behind React Native overlays as hidden', () => {
  const snapshot = makeReactNativeOverlaySnapshot();

  const appContent = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Article title" || text="Article title" || id="Article title"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );
  const overlayControl = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Minimize" || text="Minimize" || id="Minimize"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(appContent).toMatchObject({
    ok: false,
    message: expect.stringContaining('React Native overlay is covering app content'),
  });
  expect(overlayControl).toMatchObject({
    ok: true,
    node: expect.objectContaining({ label: 'Minimize' }),
  });
});

test('resolveMaestroNodeFromSnapshot blocks taps on app content behind React Native overlays', () => {
  const snapshot = makeReactNativeOverlaySnapshot();

  const appContent = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Article title" || text="Article title" || id="Article title"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );
  const overlayControl = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Dismiss" || text="Dismiss" || id="Dismiss"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(appContent).toMatchObject({
    ok: false,
    message: expect.stringContaining('React Native overlay is covering app content'),
  });
  expect(overlayControl).toMatchObject({
    ok: true,
    node: expect.objectContaining({ label: 'Dismiss' }),
  });
});

test('resolveMaestroNodeFromSnapshot prefers foreground duplicate matches', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'button',
        label: 'Show Dialog',
        rect: { x: 24, y: 220, width: 240, height: 72 },
        depth: 8,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'button',
        label: 'Show Dialog',
        rect: { x: 24, y: 220, width: 240, height: 72 },
        depth: 8,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Show Dialog" || text="Show Dialog" || id="Show Dialog"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 2 }),
  });
});

test('resolveMaestroNodeFromSnapshot preserves read order for duplicate matches in different rects', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'button',
        label: 'Open details',
        rect: { x: 24, y: 520, width: 240, height: 72 },
        depth: 8,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'button',
        label: 'Open details',
        rect: { x: 24, y: 320, width: 240, height: 72 },
        depth: 8,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Open details" || text="Open details" || id="Open details"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 1 }),
  });
});

test('resolveVisibleMaestroNodeFromSnapshot requires visible text matches to be on screen', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.TextView',
        label: 'Library',
        rect: { x: 0, y: 2340, width: 120, height: 48 },
        depth: 8,
      },
    ],
  };

  const target = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Library" || text="Library" || id="Library"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(target).toMatchObject({
    ok: false,
    message: expect.stringContaining('none were visible'),
  });
});

function makeReactNativeOverlaySnapshot(): SnapshotState {
  return {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.TextView',
        label: 'Article title',
        rect: { x: 24, y: 420, width: 320, height: 54 },
        depth: 8,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.TextView',
        label: 'AppStack.tsx (42:7)',
        rect: { x: 28, y: 1304, width: 1025, height: 44 },
        depth: 8,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'android.view.ViewGroup',
        label: 'Dismiss',
        rect: { x: 0, y: 2142, width: 540, height: 132 },
        depth: 6,
      },
      {
        index: 4,
        ref: 'e4',
        type: 'android.view.ViewGroup',
        label: 'Minimize',
        rect: { x: 540, y: 2142, width: 540, height: 132 },
        depth: 6,
      },
    ],
  };
}
