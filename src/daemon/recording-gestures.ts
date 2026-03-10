import type { RecordingGestureEvent, SessionState } from './types.ts';

const DEFAULT_TAP_GAP_MS = 90;
const DEFAULT_SWIPE_DURATION_MS = 250;
const DEFAULT_PINCH_DURATION_MS = 280;

export function recordTouchVisualizationEvent(
  session: SessionState,
  command: string,
  positionals: string[],
  result: Record<string, unknown> | void,
  fallback: Record<string, unknown> = {},
  startedAtMs = Date.now(),
): void {
  const recording = session.recording;
  if (!recording?.showTouches) return;

  const tMs = Math.max(0, startedAtMs - recording.startedAt);
  const merged = { ...fallback, ...(result ?? {}) };
  const events = buildGestureEvents(command, positionals, merged, tMs);
  if (events.length === 0) return;
  recording.gestureEvents.push(...events);
}

function buildGestureEvents(
  command: string,
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
): RecordingGestureEvent[] {
  switch (command) {
    case 'press':
      return buildPressEvents(positionals, result, tMs);
    case 'fill':
    case 'focus':
      return buildFocusEvents(positionals, result, tMs);
    case 'longpress':
      return buildLongPressEvents(positionals, result, tMs);
    case 'swipe':
      return buildSwipeEvents(positionals, result, tMs);
    case 'pinch':
      return buildPinchEvents(positionals, result, tMs);
    default:
      return [];
  }
}

function buildPressEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
): RecordingGestureEvent[] {
  const x = readNumber(result.x) ?? readNumber(positionals[0]);
  const y = readNumber(result.y) ?? readNumber(positionals[1]);
  if (x === undefined || y === undefined) return [];

  const count = clampInt(readNumber(result.count), 1) ?? 1;
  const intervalMs = clampInt(readNumber(result.intervalMs), 0) ?? 0;
  const doubleTap = result.doubleTap === true;
  const holdMs = clampInt(readNumber(result.holdMs), 1);
  const events: RecordingGestureEvent[] = [];

  for (let index = 0; index < count; index += 1) {
    const baseTime = tMs + (index * intervalMs);
    if (holdMs !== undefined && holdMs > 0) {
      events.push({ kind: 'longpress', tMs: baseTime, x, y, durationMs: holdMs });
      continue;
    }
    events.push({ kind: 'tap', tMs: baseTime, x, y });
    if (doubleTap) {
      events.push({ kind: 'tap', tMs: baseTime + DEFAULT_TAP_GAP_MS, x, y });
    }
  }
  return events;
}

function buildFocusEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
): RecordingGestureEvent[] {
  const x = readNumber(result.x) ?? readNumber(positionals[0]);
  const y = readNumber(result.y) ?? readNumber(positionals[1]);
  if (x === undefined || y === undefined) return [];
  return [{ kind: 'tap', tMs, x, y }];
}

function buildLongPressEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
): RecordingGestureEvent[] {
  const x = readNumber(result.x) ?? readNumber(positionals[0]);
  const y = readNumber(result.y) ?? readNumber(positionals[1]);
  if (x === undefined || y === undefined) return [];
  const durationMs =
    clampInt(readNumber(result.durationMs), 1)
    ?? clampInt(readNumber(positionals[2]), 1)
    ?? 800;
  return [{ kind: 'longpress', tMs, x, y, durationMs }];
}

function buildSwipeEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
): RecordingGestureEvent[] {
  const x1 = readNumber(result.x1) ?? readNumber(positionals[0]);
  const y1 = readNumber(result.y1) ?? readNumber(positionals[1]);
  const x2 = readNumber(result.x2) ?? readNumber(positionals[2]);
  const y2 = readNumber(result.y2) ?? readNumber(positionals[3]);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return [];

  const durationMs =
    clampInt(readNumber(result.durationMs), 1)
    ?? clampInt(readNumber(positionals[4]), 1)
    ?? DEFAULT_SWIPE_DURATION_MS;
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
    const startTime = tMs + (index * (durationMs + pauseMs));
    events.push({
      kind: 'swipe',
      tMs: startTime,
      x: startX,
      y: startY,
      x2: endX,
      y2: endY,
      durationMs,
    });
  }

  return events;
}

function buildPinchEvents(
  positionals: string[],
  result: Record<string, unknown>,
  tMs: number,
): RecordingGestureEvent[] {
  const x = readNumber(result.x) ?? readNumber(positionals[1]);
  const y = readNumber(result.y) ?? readNumber(positionals[2]);
  const scale = readNumber(result.scale) ?? readNumber(positionals[0]);
  if (x === undefined || y === undefined || scale === undefined || scale <= 0) return [];
  return [{ kind: 'pinch', tMs, x, y, scale, durationMs: DEFAULT_PINCH_DURATION_MS }];
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
