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

test('scroll records a semantic scroll gesture for visualization telemetry', () => {
  const session = makeSession();
  const result = augmentTouchVisualizationResult(session, 'scroll', ['down'], {
    direction: 'down',
  });

  recordTouchVisualizationEvent(session, 'scroll', ['down'], result, {}, 1_500, 1_920);

  assert.equal(session.recording?.gestureEvents.length, 1);
  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'scroll');
  if (!event || event.kind !== 'scroll') return;

  assert.equal(event.tMs, 500);
  assert.equal(event.referenceWidth, 402);
  assert.equal(event.referenceHeight, 874);
  assert.equal(event.x, 201);
  assert.equal(event.y, 612);
  assert.equal(event.x2, 201);
  assert.equal(event.y2, 262);
  assert.equal(event.durationMs, 250);
  assert.equal(event.contentDirection, 'down');
});

test('scroll amount scales swipe travel for visualization', () => {
  const session = makeSession();
  const result = augmentTouchVisualizationResult(session, 'scroll', ['right', '0.6'], {
    direction: 'right',
    amount: 0.6,
  });

  recordTouchVisualizationEvent(session, 'scroll', ['right', '0.6'], result, {}, 1_500);

  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'scroll');
  if (!event || event.kind !== 'scroll') return;

  assert.equal(event.x, 322);
  assert.equal(event.x2, 80);
  assert.equal(event.y, 437);
  assert.equal(event.y2, 437);
  assert.equal(event.amount, 0.6);
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

test('swipe visualization prefers native gesture duration when available', () => {
  const session = makeSession();

  recordTouchVisualizationEvent(
    session,
    'swipe',
    ['10', '20', '110', '220', '300'],
    {
      x1: 10,
      y1: 20,
      x2: 110,
      y2: 220,
      durationMs: 300,
      gestureStartUptimeMs: 5_000,
      gestureEndUptimeMs: 5_780,
    },
    {},
    2_000,
    2_300,
  );

  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'swipe');
  if (!event || event.kind !== 'swipe') return;

  assert.equal(event.durationMs, 780);
});

test('telemetry is still captured when touch overlays are hidden', () => {
  const session = makeSession();
  if (session.recording) {
    session.recording.showTouches = false;
  }

  recordTouchVisualizationEvent(session, 'press', ['100', '200'], { x: 100, y: 200 }, {}, 1_500);

  assert.equal(session.recording?.gestureEvents.length, 1);
  assert.equal(session.recording?.gestureEvents[0]?.kind, 'tap');
});

test('edge swipe is classified as a back-swipe telemetry event', () => {
  const session = makeSession();

  recordTouchVisualizationEvent(
    session,
    'swipe',
    ['10', '400', '180', '400', '320'],
    { x1: 10, y1: 400, x2: 180, y2: 400, durationMs: 320 },
    {},
    1_500,
    1_900,
  );

  const event = session.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'back-swipe');
  if (!event || event.kind !== 'back-swipe') return;

  assert.equal(event.edge, 'left');
  assert.equal(event.durationMs, 320);
});
