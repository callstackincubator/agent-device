import type { RecordingGestureEvent, SessionState } from './types.ts';
import type { SnapshotState } from '../utils/snapshot.ts';
import {
  resolveGestureDurationMs,
  resolveGestureOffsetMs,
  resolveTapVisualizationOffsetMs,
} from './recording-timing.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import {
  getSnapshotReferenceFrame,
  type TouchReferenceFrame as ReferenceFrame,
} from './touch-reference-frame.ts';

const DEFAULT_TAP_GAP_MS = 90;
const DEFAULT_SWIPE_DURATION_MS = 250;
const DEFAULT_PINCH_DURATION_MS = 280;
const DEFAULT_SCROLL_FRACTION = 0.4;
const MIN_SCROLL_FRACTION = 0.2;
const MAX_SCROLL_FRACTION = 0.7;
const DEFAULT_SCROLL_REFERENCE_FRAME: ReferenceFrame = {
  referenceWidth: 1000,
  referenceHeight: 1000,
};

export function recordTouchVisualizationEvent(
  session: SessionState,
  command: string,
  positionals: string[],
  result: Record<string, unknown> | void,
  fallback: Record<string, unknown> = {},
  startedAtMs = Date.now(),
  finishedAtMs = Date.now(),
): void {
  const recording = session.recording;
  if (!recording) return;

  const merged = { ...fallback, ...(result ?? {}) };
  const reportedDurationMs =
    readNumber(merged.effectiveDurationMs) ?? readNumber(merged.durationMs);
  const timingSource = {
    recordingStartedAt: recording.startedAt,
    gestureClockOriginAtMs: recording.gestureClockOriginAtMs,
    gestureClockOriginUptimeMs: recording.gestureClockOriginUptimeMs,
    runnerStartedAtUptimeMs:
      recording.platform === 'ios-device-runner' ? recording.runnerStartedAtUptimeMs : undefined,
    gestureStartUptimeMs: readNumber(merged.gestureStartUptimeMs),
    gestureEndUptimeMs: readNumber(merged.gestureEndUptimeMs),
    fallbackStartedAtMs: startedAtMs,
    fallbackFinishedAtMs: finishedAtMs,
  };
  const gestureDurationMs = resolveGestureDurationMs({
    gestureStartUptimeMs: readNumber(merged.gestureStartUptimeMs),
    gestureEndUptimeMs: readNumber(merged.gestureEndUptimeMs),
    reportedDurationMs,
    fallbackStartedAtMs: startedAtMs,
    fallbackFinishedAtMs: finishedAtMs,
  });
  const tMs =
    session.device.platform === 'ios' &&
    readNumber(merged.gestureStartUptimeMs) === undefined &&
    shouldAnchorTapVisualizationNearCompletion(command, merged)
      ? resolveTapVisualizationOffsetMs({ ...timingSource, gestureDurationMs })
      : resolveGestureOffsetMs(timingSource);
  const referenceFrame = resolveEventReferenceFrame(session.snapshot, merged);
  const events = buildGestureEvents(
    command,
    positionals,
    merged,
    tMs,
    gestureDurationMs,
    referenceFrame,
  );
  if (events.length === 0) return;
  recording.gestureEvents.push(...events);
  emitDiagnostic({
    level: 'debug',
    phase: 'record_touch_visualization_event',
    data: {
      session: session.name,
      command,
      count: events.length,
      tMs,
      gestureDurationMs,
      kinds: events.map((event) => event.kind),
    },
  });
}

// Scroll commands do not carry a concrete gesture path from the platform layer, so we
// synthesize one here before recording telemetry.
export function augmentScrollVisualizationResult(
  session: SessionState,
  command: string,
  positionals: string[],
  result: Record<string, unknown> | void,
): Record<string, unknown> | void {
  if (command !== 'scroll') return result;

  const referenceFrame = getSnapshotReferenceFrame(session.snapshot);
  const merged = { ...(result ?? {}) };
  const contentDirection = readDirection(merged.direction) ?? readDirection(positionals[0]);
  if (!contentDirection) return result;

  const amountValue = readNumber(merged.amount) ?? readNumber(positionals[1]);
  const travelFraction = resolveScrollTravelFraction(amountValue);
  const explicitReferenceWidth = readNumber(merged.referenceWidth);
  const explicitReferenceHeight = readNumber(merged.referenceHeight);
  const fallbackReferenceFrame =
    explicitReferenceWidth !== undefined &&
    explicitReferenceWidth > 0 &&
    explicitReferenceHeight !== undefined &&
    explicitReferenceHeight > 0
      ? {
          referenceWidth: explicitReferenceWidth,
          referenceHeight: explicitReferenceHeight,
        }
      : (referenceFrame ?? DEFAULT_SCROLL_REFERENCE_FRAME);
  const { start, end } = scrollPoints(contentDirection, fallbackReferenceFrame, travelFraction);

  return {
    ...merged,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    contentDirection,
    amount: amountValue,
    referenceWidth: fallbackReferenceFrame.referenceWidth,
    referenceHeight: fallbackReferenceFrame.referenceHeight,
    durationMs: DEFAULT_SWIPE_DURATION_MS,
  };
}

function buildGestureEvents(
  command: string,
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  gestureDurationMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  switch (command) {
    case 'click':
    case 'press':
      return buildPressEvents(positionals, result, tMs, referenceFrame);
    case 'fill':
    case 'focus':
      return buildFocusEvents(positionals, result, tMs, referenceFrame);
    case 'longpress':
      return buildLongPressEvents(positionals, result, tMs, gestureDurationMs, referenceFrame);
    case 'scroll':
      return buildScrollEvents(positionals, result, tMs, gestureDurationMs, referenceFrame);
    case 'swipe':
      return buildSwipeEvents(positionals, result, tMs, gestureDurationMs, referenceFrame);
    case 'pinch':
      return buildPinchEvents(positionals, result, tMs, gestureDurationMs, referenceFrame);
    default:
      return [];
  }
}

function shouldAnchorTapVisualizationNearCompletion(
  command: string,
  result: Record<string, unknown>,
): boolean {
  switch (command) {
    case 'click':
    case 'fill':
    case 'focus':
      return true;
    case 'press': {
      const count = clampInt(readNumber(result.count), 1) ?? 1;
      const doubleTap = result.doubleTap === true;
      const holdMs = clampInt(readNumber(result.holdMs), 1);
      return count === 1 && !doubleTap && holdMs === undefined;
    }
    default:
      return false;
  }
}

function buildPressEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  const coordinates = readCoordinates(result, positionals);
  if (!coordinates) return [];
  const { x, y } = coordinates;

  const count = clampInt(readNumber(result.count), 1) ?? 1;
  const intervalMs = clampInt(readNumber(result.intervalMs), 0) ?? 0;
  const doubleTap = result.doubleTap === true;
  const holdMs = clampInt(readNumber(result.holdMs), 1);
  const events: RecordingGestureEvent[] = [];

  for (let index = 0; index < count; index += 1) {
    const baseTime = tMs + index * intervalMs;
    if (holdMs !== undefined && holdMs > 0) {
      events.push(makeLongPressEvent(baseTime, x, y, holdMs, referenceFrame));
      continue;
    }
    events.push(makeTapEvent(baseTime, x, y, referenceFrame));
    if (doubleTap) {
      events.push(makeTapEvent(baseTime + DEFAULT_TAP_GAP_MS, x, y, referenceFrame));
    }
  }
  return events;
}

function buildFocusEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  const coordinates = readCoordinates(result, positionals);
  if (!coordinates) return [];
  const { x, y } = coordinates;
  return [makeTapEvent(tMs, x, y, referenceFrame)];
}

function buildLongPressEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  gestureDurationMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  const coordinates = readCoordinates(result, positionals);
  if (!coordinates) return [];
  const { x, y } = coordinates;
  const durationMs = resolveDurationMs(
    gestureDurationMs,
    [readNumber(result.durationMs), readNumber(positionals[2])],
    800,
  );
  return [makeLongPressEvent(tMs, x, y, durationMs, referenceFrame)];
}

function buildSwipeEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  gestureDurationMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  const coordinates = readTravelCoordinates(result, positionals);
  if (!coordinates) return [];
  const { x1, y1, x2, y2 } = coordinates;

  const durationMs = resolveDurationMs(
    gestureDurationMs,
    [
      readNumber(result.effectiveDurationMs),
      readNumber(result.durationMs),
      readNumber(positionals[4]),
    ],
    DEFAULT_SWIPE_DURATION_MS,
  );
  const count = clampInt(readNumber(result.count), 1) ?? 1;
  const pauseMs = clampInt(readNumber(result.pauseMs), 0) ?? 0;
  const pattern = result.pattern === 'ping-pong' ? 'ping-pong' : 'one-way';
  const events: RecordingGestureEvent[] = [];

  for (let index = 0; index < count; index += 1) {
    const reverse = pattern === 'ping-pong' && index % 2 === 1;
    const startX = reverse ? x2 : x1;
    const startY = reverse ? y2 : y1;
    const endX = reverse ? x1 : x2;
    const endY = reverse ? y1 : y2;
    const startTime = tMs + index * (durationMs + pauseMs);
    const kind = classifySwipeKind(startX, startY, endX, endY, referenceFrame);
    if (kind === 'back-swipe') {
      events.push({
        kind: 'back-swipe',
        tMs: startTime,
        x: startX,
        y: startY,
        x2: endX,
        y2: endY,
        ...referenceFrame,
        durationMs,
        edge: resolveBackSwipeEdge(startX, endX, referenceFrame),
      });
      continue;
    }
    events.push({
      kind: 'swipe',
      tMs: startTime,
      x: startX,
      y: startY,
      x2: endX,
      y2: endY,
      ...referenceFrame,
      durationMs,
    });
  }

  return events;
}

function buildScrollEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  gestureDurationMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  const coordinates = readTravelCoordinates(result, positionals);
  const contentDirection =
    readDirection(result.contentDirection) ?? readDirection(result.direction);
  if (!coordinates || !contentDirection) {
    return [];
  }
  const { x1, y1, x2, y2 } = coordinates;

  const durationMs = resolveDurationMs(gestureDurationMs, [], DEFAULT_SWIPE_DURATION_MS);
  const amount = readNumber(result.amount) ?? readNumber(positionals[1]);
  return [
    {
      kind: 'scroll',
      tMs,
      x: x1,
      y: y1,
      x2,
      y2,
      ...referenceFrame,
      durationMs,
      contentDirection,
      ...(amount !== undefined ? { amount } : {}),
    },
  ];
}

function buildPinchEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
  gestureDurationMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent[] {
  const coordinates = readCoordinates(result, positionals, 1);
  const scale = readNumber(result.scale) ?? readNumber(positionals[0]);
  if (!coordinates || scale === undefined || scale <= 0) return [];
  const { x, y } = coordinates;
  return [
    {
      kind: 'pinch',
      tMs,
      x,
      y,
      ...referenceFrame,
      scale,
      durationMs: resolveDurationMs(gestureDurationMs, [], DEFAULT_PINCH_DURATION_MS),
    },
  ];
}

function makeTapEvent(
  tMs: number,
  x: number,
  y: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent {
  return { kind: 'tap', tMs, x, y, ...referenceFrame };
}

function makeLongPressEvent(
  tMs: number,
  x: number,
  y: number,
  durationMs: number,
  referenceFrame?: ReferenceFrame,
): RecordingGestureEvent {
  return { kind: 'longpress', tMs, x, y, ...referenceFrame, durationMs };
}

function classifySwipeKind(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  referenceFrame?: ReferenceFrame,
): 'swipe' | 'back-swipe' {
  if (!referenceFrame) return 'swipe';
  const horizontalDistance = Math.abs(x2 - x1);
  const verticalDistance = Math.abs(y2 - y1);
  if (horizontalDistance <= verticalDistance * 1.25) return 'swipe';

  const edgeInset = referenceFrame.referenceWidth * 0.08;
  if (x1 <= edgeInset && x2 > x1) return 'back-swipe';
  if (x1 >= referenceFrame.referenceWidth - edgeInset && x2 < x1) return 'back-swipe';
  return 'swipe';
}

function resolveBackSwipeEdge(
  startX: number,
  endX: number,
  referenceFrame?: ReferenceFrame,
): 'left' | 'right' {
  if (referenceFrame) {
    const edgeInset = referenceFrame.referenceWidth * 0.08;
    if (startX <= edgeInset) return 'left';
    if (startX >= referenceFrame.referenceWidth - edgeInset) return 'right';
  }
  return endX >= startX ? 'left' : 'right';
}

function resolveEventReferenceFrame(
  snapshot: SnapshotState | undefined,
  result: Record<string, unknown>,
): ReferenceFrame | undefined {
  const referenceWidth = readNumber(result.referenceWidth);
  const referenceHeight = readNumber(result.referenceHeight);
  if (
    referenceWidth !== undefined &&
    referenceWidth > 0 &&
    referenceHeight !== undefined &&
    referenceHeight > 0
  ) {
    return { referenceWidth, referenceHeight };
  }

  return getSnapshotReferenceFrame(snapshot);
}

function readDirection(value: unknown): 'up' | 'down' | 'left' | 'right' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      return normalized as 'up' | 'down' | 'left' | 'right';
    default:
      return undefined;
  }
}

function resolveScrollTravelFraction(amount: number | undefined): number {
  if (amount === undefined) return DEFAULT_SCROLL_FRACTION;
  if (!Number.isFinite(amount) || amount <= 0) return DEFAULT_SCROLL_FRACTION;
  if (amount <= 1) {
    return clampNumber(amount, MIN_SCROLL_FRACTION, MAX_SCROLL_FRACTION);
  }
  return clampNumber(amount / 100, MIN_SCROLL_FRACTION, MAX_SCROLL_FRACTION);
}

function scrollPoints(
  contentDirection: 'up' | 'down' | 'left' | 'right',
  referenceFrame: ReferenceFrame,
  travelFraction: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const midX = Math.round(referenceFrame.referenceWidth / 2);
  const midY = Math.round(referenceFrame.referenceHeight / 2);
  const travelX = Math.round((referenceFrame.referenceWidth * travelFraction) / 2);
  const travelY = Math.round((referenceFrame.referenceHeight * travelFraction) / 2);

  switch (contentDirection) {
    case 'up':
      return {
        start: { x: midX, y: midY - travelY },
        end: { x: midX, y: midY + travelY },
      };
    case 'down':
      return {
        start: { x: midX, y: midY + travelY },
        end: { x: midX, y: midY - travelY },
      };
    case 'left':
      return {
        start: { x: midX - travelX, y: midY },
        end: { x: midX + travelX, y: midY },
      };
    case 'right':
      return {
        start: { x: midX + travelX, y: midY },
        end: { x: midX - travelX, y: midY },
      };
  }
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInt(value: number | undefined, min: number): number | undefined {
  if (value === undefined) return undefined;
  const normalized = Math.floor(value);
  return normalized >= min ? normalized : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readCoordinates(
  result: Record<string, unknown>,
  positionals: string[],
  positionalOffset = 0,
): { x: number; y: number } | undefined {
  const x = readNumber(result.x) ?? readNumber(positionals[positionalOffset]);
  const y = readNumber(result.y) ?? readNumber(positionals[positionalOffset + 1]);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y };
}

function readTravelCoordinates(
  result: Record<string, unknown>,
  positionals: string[],
): { x1: number; y1: number; x2: number; y2: number } | undefined {
  const x1 = readNumber(result.x1) ?? readNumber(positionals[0]);
  const y1 = readNumber(result.y1) ?? readNumber(positionals[1]);
  const x2 = readNumber(result.x2) ?? readNumber(positionals[2]);
  const y2 = readNumber(result.y2) ?? readNumber(positionals[3]);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }
  return { x1, y1, x2, y2 };
}

function resolveDurationMs(
  gestureDurationMs: number,
  candidates: Array<number | undefined>,
  fallbackDurationMs: number,
): number {
  return (
    clampInt(gestureDurationMs, 1) ??
    candidates
      .map((candidate) => clampInt(candidate, 1))
      .find((candidate) => candidate !== undefined) ??
    fallbackDurationMs
  );
}
