import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { ANDROID_EMULATOR, IOS_SIMULATOR } from '../../__tests__/test-utils/device-fixtures.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import {
  capturePostGestureStabilizedSnapshot,
  markPostGestureStabilization,
} from '../post-gesture-stabilization.ts';
import type { SessionState } from '../types.ts';

afterEach(() => {
  vi.useRealTimers();
});

test('markPostGestureStabilization marks iOS swipe sessions', () => {
  const session = makeSession();

  markPostGestureStabilization(session, 'swipe');

  assert.equal(session.postGestureStabilization?.action, 'swipe');
});

test('markPostGestureStabilization marks Android swipe sessions', () => {
  const session = makeSession('android');

  markPostGestureStabilization(session, 'swipe');

  assert.equal(session.postGestureStabilization?.action, 'swipe');
});

test('capturePostGestureStabilizedSnapshot retries until rects stop moving', async () => {
  vi.useFakeTimers();
  const session = makeSession();
  markPostGestureStabilization(session, 'swipe');
  const snapshots = [makeSnapshot(100), makeSnapshot(80), makeSnapshot(80.4)];

  const promise = capturePostGestureStabilizedSnapshot({
    session,
    capture: async () => snapshots.shift() ?? makeSnapshot(80.4),
  });

  await vi.advanceTimersByTimeAsync(400);
  const snapshot = await promise;

  assert.equal(snapshot.nodes[1]?.rect?.y, 80.4);
  assert.equal(session.postGestureStabilization, undefined);
});

function makeSession(platform: 'ios' | 'android' = 'ios'): SessionState {
  return {
    name: platform,
    device: platform === 'android' ? ANDROID_EMULATOR : IOS_SIMULATOR,
    createdAt: Date.now(),
    actions: [],
  };
}

function makeSnapshot(y: number): SnapshotState {
  return {
    nodes: [
      {
        ref: 'e1',
        index: 0,
        type: 'Application',
        label: 'App',
        rect: { x: 0, y: 0, width: 390, height: 844 },
      },
      {
        ref: 'e2',
        index: 1,
        parentIndex: 0,
        type: 'Button',
        identifier: 'shipping-pickup',
        label: 'Pickup',
        rect: { x: 120, y, width: 80, height: 40 },
      },
    ],
    createdAt: Date.now(),
    backend: 'xctest',
  };
}
