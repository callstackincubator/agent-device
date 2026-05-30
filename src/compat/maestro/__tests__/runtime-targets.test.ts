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

test('resolveMaestroNodeFromSnapshot does not match plain text as a substring', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.Button',
        label: 'Push feed',
        rect: { x: 32, y: 320, width: 280, height: 96 },
        enabled: true,
        hittable: true,
        depth: 5,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'StaticText',
        label: 'Albums, back',
        rect: { x: 120, y: 80, width: 180, height: 48 },
        depth: 5,
      },
    ],
  };

  const plain = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Feed" || text="Feed" || id="Feed"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );
  const regex = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label=".*feed" || text=".*feed" || id=".*feed"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );
  const composite = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Albums" || text="Albums" || id="Albums"',
    'ios',
    { referenceWidth: 402, referenceHeight: 874 },
  );

  expect(plain).toMatchObject({
    ok: false,
    message: expect.stringContaining('Feed'),
  });
  expect(regex).toMatchObject({
    ok: true,
    node: expect.objectContaining({ label: 'Push feed' }),
  });
  expect(composite).toMatchObject({
    ok: true,
    node: expect.objectContaining({ label: 'Albums, back' }),
  });
});

test('resolveVisibleMaestroNodeFromSnapshot does not block content behind collapsed React Native warnings', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.TextView',
        label: 'Morning Favorites',
        rect: { x: 24, y: 420, width: 320, height: 54 },
        depth: 8,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.view.ViewGroup',
        label: 'Open debugger to view warnings',
        rect: { x: 0, y: 2190, width: 1080, height: 96 },
        depth: 6,
      },
    ],
  };

  const appContent = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Morning Favorites" || text="Morning Favorites" || id="Morning Favorites"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(appContent).toMatchObject({
    ok: true,
    node: expect.objectContaining({ label: 'Morning Favorites' }),
  });
});

test('resolveMaestroNodeFromSnapshot childOf resolves parent links by node index', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 7,
        ref: 'e7',
        identifier: 'other-row',
        rect: { x: 0, y: 0, width: 320, height: 80 },
      },
      {
        index: 99,
        ref: 'e99',
        parentIndex: 42,
        identifier: 'childActionButton',
        rect: { x: 240, y: 120, width: 64, height: 48 },
      },
      {
        index: 42,
        ref: 'e42',
        identifier: 'parent-row-secondary',
        rect: { x: 0, y: 96, width: 320, height: 80 },
      },
      {
        index: 8,
        ref: 'e8',
        parentIndex: 7,
        identifier: 'childActionButton',
        rect: { x: 240, y: 16, width: 64, height: 48 },
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'id="childActionButton"',
    { childOf: 'id="parent-row-secondary"' },
    'ios',
    { referenceWidth: 320, referenceHeight: 640 },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 99 }),
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

test('resolveMaestroNodeFromSnapshot prefers duplicate text on foreground overlapping screen', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.ScrollView',
        label: 'Article, Go back, Show Dialog',
        rect: { x: 0, y: 120, width: 1080, height: 1800 },
        depth: 6,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.Button',
        label: 'Show Dialog',
        rect: { x: 720, y: 980, width: 280, height: 88 },
        enabled: true,
        hittable: true,
        depth: 14,
        parentIndex: 1,
      },
      {
        index: 30,
        ref: 'e30',
        type: 'android.widget.ScrollView',
        label: 'NewsFeed, Push NewsFeed, Show Dialog',
        rect: { x: 0, y: 120, width: 1080, height: 1800 },
        depth: 6,
      },
      {
        index: 31,
        ref: 'e31',
        type: 'android.widget.Button',
        label: 'Show Dialog',
        rect: { x: 720, y: 1320, width: 280, height: 88 },
        enabled: true,
        hittable: true,
        depth: 14,
        parentIndex: 30,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Show Dialog" || text="Show Dialog" || id="Show Dialog"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 31 }),
    rect: { x: 720, y: 1320, width: 280, height: 88 },
  });
});

test('resolveMaestroNodeFromSnapshot prefers full-width screen over stale side navigation duplicate', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.ScrollView',
        label: 'Article, Go back, Replace params',
        rect: { x: 0, y: 319, width: 1080, height: 2021 },
        depth: 17,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.Button',
        label: 'Go back',
        rect: { x: 33, y: 667, width: 1014, height: 110 },
        enabled: true,
        hittable: true,
        depth: 19,
        parentIndex: 1,
      },
      {
        index: 30,
        ref: 'e30',
        type: 'android.widget.ScrollView',
        label: 'Albums, Go back, Go to Article',
        rect: { x: 0, y: 319, width: 816, height: 2021 },
        depth: 17,
      },
      {
        index: 31,
        ref: 'e31',
        type: 'android.widget.Button',
        label: 'Go back',
        rect: { x: 0, y: 581, width: 783, height: 110 },
        enabled: true,
        hittable: true,
        depth: 19,
        parentIndex: 30,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Go back" || text="Go back" || id="Go back"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 2 }),
    rect: { x: 33, y: 667, width: 1014, height: 110 },
  });
});

test('resolveMaestroNodeFromSnapshot uses visible assertion context for equal overlapping screens', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 6,
        ref: 'e6',
        type: 'android.view.View',
        label: 'Albums',
        value: 'Albums',
        rect: { x: 154, y: 194, width: 188, height: 74 },
        depth: 22,
        parentIndex: 25,
      },
      {
        index: 7,
        ref: 'e7',
        type: 'android.widget.ScrollView',
        rect: { x: 0, y: 319, width: 1080, height: 2021 },
        depth: 17,
      },
      {
        index: 8,
        ref: 'e8',
        type: 'android.widget.Button',
        label: 'Push albums',
        rect: { x: 33, y: 352, width: 361, height: 110 },
        enabled: true,
        hittable: true,
        depth: 19,
        parentIndex: 7,
      },
      {
        index: 12,
        ref: 'e12',
        type: 'android.widget.Button',
        label: 'Push article',
        rect: { x: 33, y: 495, width: 340, height: 110 },
        enabled: true,
        hittable: true,
        depth: 19,
        parentIndex: 7,
      },
      {
        index: 13,
        ref: 'e13',
        type: 'android.widget.TextView',
        label: 'Push article',
        value: 'Push article',
        rect: { x: 99, y: 523, width: 208, height: 55 },
        depth: 20,
        parentIndex: 12,
      },
      {
        index: 25,
        ref: 'e25',
        type: 'android.widget.ScrollView',
        rect: { x: 0, y: 319, width: 1080, height: 2021 },
        depth: 17,
      },
      {
        index: 26,
        ref: 'e26',
        type: 'android.widget.Button',
        label: 'Push article',
        rect: { x: 33, y: 352, width: 340, height: 110 },
        enabled: true,
        hittable: true,
        depth: 19,
        parentIndex: 25,
      },
      {
        index: 27,
        ref: 'e27',
        type: 'android.widget.TextView',
        label: 'Push article',
        value: 'Push article',
        rect: { x: 99, y: 380, width: 208, height: 55 },
        depth: 20,
        parentIndex: 26,
      },
      {
        index: 30,
        ref: 'e30',
        type: 'android.widget.Button',
        label: 'Push albums',
        rect: { x: 33, y: 495, width: 361, height: 110 },
        enabled: true,
        hittable: true,
        depth: 19,
        parentIndex: 25,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Push article" || text="Push article" || id="Push article"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
    {
      promoteTapTarget: true,
      preferredContext: {
        node: snapshot.nodes[0]!,
        rect: snapshot.nodes[0]!.rect!,
      },
    },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 12 }),
    rect: { x: 33, y: 495, width: 340, height: 110 },
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

test('resolveVisibleMaestroNodeFromSnapshot ignores Android rectless hidden navigation labels', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.view.ViewGroup',
        label: '',
        rect: { x: 0, y: 0, width: 1080, height: 2340 },
        depth: 1,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.Button',
        label: 'Chat',
        enabled: true,
        hittable: true,
        depth: 2,
        parentIndex: 1,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'android.widget.TextView',
        label: 'Chat',
        value: 'Chat',
        depth: 3,
        parentIndex: 2,
      },
    ],
  };

  const target = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    'label="Chat" || text="Chat" || id="Chat"',
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
  );

  expect(target).toMatchObject({
    ok: false,
    message: expect.stringContaining('none were visible'),
  });
});

test('resolveMaestroNodeFromSnapshot prefers concrete Android tab rect over hidden drawer label', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.view.ViewGroup',
        label: '',
        rect: { x: 0, y: 0, width: 1080, height: 2340 },
        depth: 1,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.FrameLayout',
        label: 'Albums',
        rect: { x: 540, y: 2054, width: 270, height: 220 },
        enabled: true,
        hittable: true,
        depth: 16,
        parentIndex: 1,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'android.view.ViewGroup',
        label: '',
        rect: { x: 0, y: 0, width: 816, height: 2340 },
        depth: 1,
      },
      {
        index: 4,
        ref: 'e4',
        type: 'android.widget.Button',
        label: '\udb80\udeea, Albums',
        enabled: true,
        hittable: true,
        depth: 18,
        parentIndex: 3,
      },
      {
        index: 5,
        ref: 'e5',
        type: 'android.widget.TextView',
        label: 'Albums',
        value: 'Albums',
        enabled: true,
        hittable: false,
        depth: 19,
        parentIndex: 4,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Albums" || text="Albums" || id="Albums"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 2 }),
    rect: { x: 540, y: 2054, width: 270, height: 220 },
  });
});

test('resolveMaestroNodeFromSnapshot ignores Android nodes hidden from users', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.Button',
        label: 'Settings',
        rect: { x: 0, y: 0, width: 200, height: 80 },
        enabled: true,
        hittable: true,
        visibleToUser: false,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.Button',
        label: 'Settings',
        rect: { x: 300, y: 700, width: 200, height: 80 },
        enabled: true,
        hittable: true,
        visibleToUser: true,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Settings"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 2 }),
    rect: { x: 300, y: 700, width: 200, height: 80 },
  });
});

test('resolveMaestroNodeFromSnapshot prefers exact Android tab label over normalized header icon text', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'android.widget.FrameLayout',
        label: 'Search',
        rect: { x: 810, y: 2054, width: 270, height: 132 },
        enabled: true,
        hittable: true,
        depth: 16,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'android.widget.Button',
        label: 'search',
        rect: { x: 673, y: 165, width: 132, height: 132 },
        enabled: true,
        hittable: true,
        depth: 22,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'android.widget.TextView',
        label: 'search',
        value: 'search',
        rect: { x: 706, y: 198, width: 66, height: 66 },
        enabled: true,
        depth: 23,
        parentIndex: 2,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Search" || text="Search" || id="Search"',
    {},
    'android',
    { referenceWidth: 1080, referenceHeight: 2340 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 1 }),
    rect: { x: 810, y: 2054, width: 270, height: 132 },
  });
});

test('resolveMaestroNodeFromSnapshot infers missing selected tab slot from tab-strip children', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'ScrollView',
        label: 'Chat',
        rect: { x: 0, y: 116.66666412353516, width: 402, height: 48 },
        depth: 3,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'Cell',
        label: 'Contacts',
        rect: { x: 134, y: 116.66666412353516, width: 134, height: 48 },
        depth: 4,
        parentIndex: 1,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'Cell',
        label: 'Albums',
        rect: { x: 268, y: 116.66666412353516, width: 134, height: 48 },
        depth: 4,
        parentIndex: 1,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Chat" || text="Chat" || id="Chat"',
    {},
    'ios',
    { referenceWidth: 402, referenceHeight: 874 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 1 }),
    rect: { x: 0, y: 116.66666412353516, width: 134, height: 48 },
  });
});

test('resolveMaestroNodeFromSnapshot keeps concrete child matches over tab-strip inference', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'ScrollView',
        label: 'Article by Gandalf',
        rect: { x: 0, y: 58.33333333333333, width: 402, height: 58.33333333333333 },
        depth: 4,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'Cell',
        label: 'Article by Gandalf',
        rect: { x: 8, y: 65.33333587646484, width: 155, height: 48 },
        depth: 5,
        parentIndex: 1,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Article by Gandalf" || text="Article by Gandalf" || id="Article by Gandalf"',
    {},
    'ios',
    { referenceWidth: 402, referenceHeight: 874 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 2 }),
    rect: { x: 8, y: 65.33333587646484, width: 155, height: 48 },
  });
});

test('resolveMaestroNodeFromSnapshot prefers localized breadcrumb label over broad containers', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'Other',
        label: 'Article by Gandalf',
        rect: { x: 0, y: 0, width: 402, height: 116.66666412353516 },
        depth: 12,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'ScrollView',
        label: 'Article by Gandalf',
        rect: { x: 0, y: 0, width: 402, height: 116.66666666666666 },
        depth: 13,
        parentIndex: 1,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'Other',
        label: 'Article by Gandalf',
        rect: { x: 0, y: 0, width: 232.3333282470703, height: 116.33333587646484 },
        depth: 14,
        parentIndex: 2,
      },
      {
        index: 4,
        ref: 'e4',
        type: 'Other',
        label: 'Article by Gandalf',
        rect: { x: 0, y: 0, width: 232.3333282470703, height: 116.33333587646484 },
        depth: 15,
        parentIndex: 3,
      },
      {
        index: 5,
        ref: 'e5',
        type: 'Other',
        label: 'Article by Gandalf',
        rect: { x: 8, y: 65.33333587646484, width: 155, height: 48 },
        depth: 16,
        parentIndex: 4,
      },
      {
        index: 6,
        ref: 'e6',
        type: 'Other',
        label: 'Feed',
        rect: { x: 170.3333282470703, y: 65.33333587646484, width: 54, height: 48 },
        depth: 16,
        parentIndex: 4,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Article by Gandalf" || text="Article by Gandalf" || id="Article by Gandalf"',
    {},
    'ios',
    { referenceWidth: 402, referenceHeight: 874 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 5 }),
    rect: { x: 8, y: 65.33333587646484, width: 155, height: 48 },
  });
});

test('resolveMaestroNodeFromSnapshot infers leading breadcrumb slot when selected child is omitted', () => {
  const snapshot: SnapshotState = {
    createdAt: Date.now(),
    nodes: [
      {
        index: 1,
        ref: 'e1',
        type: 'ScrollView',
        label: 'Article by Gandalf',
        rect: { x: 0, y: 58.33333333333333, width: 402, height: 58.33333333333333 },
        depth: 4,
      },
      {
        index: 2,
        ref: 'e2',
        type: 'Other',
        label: 'Feed',
        rect: { x: 170.3333282470703, y: 65.33333587646484, width: 54, height: 48 },
        depth: 5,
        parentIndex: 1,
      },
      {
        index: 3,
        ref: 'e3',
        type: 'Other',
        label: 'Albums',
        rect: { x: 231.6666717529297, y: 65.33333587646484, width: 75, height: 48 },
        depth: 5,
        parentIndex: 1,
      },
    ],
  };

  const target = resolveMaestroNodeFromSnapshot(
    snapshot,
    'label="Article by Gandalf" || text="Article by Gandalf" || id="Article by Gandalf"',
    {},
    'ios',
    { referenceWidth: 402, referenceHeight: 874 },
    { promoteTapTarget: true },
  );

  expect(target).toMatchObject({
    ok: true,
    node: expect.objectContaining({ index: 1 }),
    rect: { x: 0, y: 58.33333333333333, width: 168, height: 58.33333333333333 },
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
