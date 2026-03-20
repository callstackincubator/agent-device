import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionState } from '../types.ts';
import {
  augmentTouchVisualizationResult,
  recordTouchVisualizationEvent,
} from '../recording-gestures.ts';
import { attachRefs } from '../../utils/snapshot.ts';

function makeSession(): SessionState {
  return {
    name: 'default',
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
    snapshot: {
      nodes: attachRefs([
        {
          index: 0,
          type: 'Application',
          rect: { x: 0, y: 0, width: 402, height: 874 },
        },
      ]),
      createdAt: Date.now(),
      backend: 'xctest',
    },
    recording: {
      platform: 'ios',
      outPath: '/tmp/demo.mp4',
      startedAt: 1_000,
      showTouches: true,
      gestureEvents: [],
      child: { kill: () => {} } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    },
  };
}

test('scroll records a continuous swipe gesture for visualization', () => {
  const session = makeSession();
  const result = augmentTouchVisualizationResult(session, 'scroll', ['down'], {
    direction: 'down',
  });

  recordTouchVisualizationEvent(session, 'scroll', ['down'], result, {}, 1_500);

  assert.equal(session.recording?.gestureEvents.length, 1);
  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'swipe');
  if (!event || event.kind !== 'swipe') return;

  assert.equal(event.tMs, 500);
  assert.equal(event.referenceWidth, 402);
  assert.equal(event.referenceHeight, 874);
  assert.equal(event.x, 201);
  assert.equal(event.y, 612);
  assert.equal(event.x2, 201);
  assert.equal(event.y2, 262);
});

test('scroll amount scales swipe travel for visualization', () => {
  const session = makeSession();
  const result = augmentTouchVisualizationResult(session, 'scroll', ['right', '0.6'], {
    direction: 'right',
    amount: 0.6,
  });

  recordTouchVisualizationEvent(session, 'scroll', ['right', '0.6'], result, {}, 1_500);

  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'swipe');
  if (!event || event.kind !== 'swipe') return;

  assert.equal(event.x, 322);
  assert.equal(event.x2, 80);
  assert.equal(event.y, 437);
  assert.equal(event.y2, 437);
});

test('scroll augmentation synthesizes swipe geometry from viewport', () => {
  const session = makeSession();
  const augmented = augmentTouchVisualizationResult(session, 'scroll', ['up'], { direction: 'up' });
  assert.ok(augmented);
  assert.equal((augmented as Record<string, unknown>).x1, 201);
  assert.equal((augmented as Record<string, unknown>).y1, 262);
  assert.equal((augmented as Record<string, unknown>).x2, 201);
  assert.equal((augmented as Record<string, unknown>).y2, 612);
});

test('scroll augmentation falls back to normalized geometry without a snapshot', () => {
  const session = makeSession();
  session.snapshot = undefined;

  const augmented = augmentTouchVisualizationResult(session, 'scroll', ['down'], {
    direction: 'down',
  });

  assert.ok(augmented);
  assert.equal((augmented as Record<string, unknown>).referenceWidth, 1000);
  assert.equal((augmented as Record<string, unknown>).referenceHeight, 1000);

  recordTouchVisualizationEvent(session, 'scroll', ['down'], augmented, {}, 1_500);

  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'swipe');
  if (!event || event.kind !== 'swipe') return;

  assert.equal(event.referenceWidth, 1000);
  assert.equal(event.referenceHeight, 1000);
  assert.equal(event.x, 500);
  assert.equal(event.y, 700);
  assert.equal(event.x2, 500);
  assert.equal(event.y2, 300);
});

test('gesture recording prefers native runner timing when available', () => {
  const session = makeSession();
  session.recording = {
    platform: 'ios-device-runner',
    outPath: '/tmp/demo.mp4',
    remotePath: 'tmp/demo.mp4',
    startedAt: 1_000,
    showTouches: true,
    gestureEvents: [],
    runnerStartedAtUptimeMs: 5_000,
  };

  recordTouchVisualizationEvent(
    session,
    'press',
    ['201', '437'],
    { x: 201, y: 437, gestureStartUptimeMs: 5_180 },
    {},
    9_999,
  );

  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'tap');
  assert.equal(event?.tMs, 180);
});

test('gesture recording caches reference frame on the snapshot', () => {
  const session = makeSession();
  assert.equal(session.snapshot?.referenceWidth, undefined);
  assert.equal(session.snapshot?.referenceHeight, undefined);

  recordTouchVisualizationEvent(session, 'press', ['201', '437'], { x: 201, y: 437 }, {}, 1_500);

  assert.equal(session.snapshot?.referenceWidth, 402);
  assert.equal(session.snapshot?.referenceHeight, 874);
});
