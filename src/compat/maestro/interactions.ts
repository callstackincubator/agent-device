import type { SessionAction } from '../../daemon/types.ts';
import { AppError } from '../../utils/errors.ts';
import {
  action,
  assertOnlyKeys,
  isPlainRecord,
  readTimeoutMs,
  requireStringValue,
  resolveMaestroString,
  unsupportedMaestroSyntax,
} from './support.ts';
import type { MaestroParseContext } from './types.ts';

export function convertTapOn(value: unknown, context: MaestroParseContext): SessionAction {
  if (isPlainRecord(value) && typeof value.point === 'string') {
    assertOnlyKeys(value, 'tapOn', ['point', 'repeat', 'delay']);
    const point = parsePoint(value.point);
    return action('click', [String(point.x), String(point.y)], tapFlags(value));
  }
  if (isPlainRecord(value)) {
    assertOnlyKeys(value, 'tapOn', [
      'id',
      'text',
      'enabled',
      'selected',
      'repeat',
      'delay',
      'optional',
      'label',
    ]);
  }
  return action(
    'click',
    [maestroSelector(value, 'tapOn', ['repeat', 'delay', 'optional', 'label'], context)],
    tapFlags(value),
  );
}

export function convertDoubleTapOn(value: unknown, context: MaestroParseContext): SessionAction {
  if (isPlainRecord(value) && typeof value.point === 'string') {
    assertOnlyKeys(value, 'doubleTapOn', ['point', 'delay']);
    const point = parsePoint(value.point);
    return action('click', [String(point.x), String(point.y)], doubleTapFlags(value));
  }
  if (isPlainRecord(value)) {
    assertOnlyKeys(value, 'doubleTapOn', ['id', 'text', 'enabled', 'selected', 'delay']);
  }
  return action(
    'click',
    [maestroSelector(value, 'doubleTapOn', ['delay'], context)],
    doubleTapFlags(value),
  );
}

export function convertLongPressOn(value: unknown, context: MaestroParseContext): SessionAction {
  if (isPlainRecord(value) && typeof value.point === 'string') {
    assertOnlyKeys(value, 'longPressOn', ['point']);
    const point = parsePoint(value.point);
    return action('longpress', [String(point.x), String(point.y), '3000']);
  }
  if (isPlainRecord(value)) {
    assertOnlyKeys(value, 'longPressOn', ['id', 'text', 'enabled', 'selected']);
  }
  return action('click', [maestroSelector(value, 'longPressOn', [], context)], { holdMs: 3000 });
}

export function readInputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'inputText expects a string or map.');
  }
  assertOnlyKeys(value, 'inputText', ['text', 'label']);
  if (typeof value.text !== 'string') {
    throw new AppError('INVALID_ARGS', 'inputText map requires a string text field.');
  }
  return value.text;
}

export function convertExtendedWaitUntil(
  value: unknown,
  context: MaestroParseContext,
): SessionAction[] {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'extendedWaitUntil expects a map.');
  }
  assertOnlyKeys(value, 'extendedWaitUntil', ['visible', 'notVisible', 'timeout']);
  const target = value.visible ?? value.notVisible;
  if (target === undefined) {
    throw unsupportedMaestroSyntax(
      'Only Maestro extendedWaitUntil.visible/notVisible is supported.',
    );
  }
  const selector = maestroSelector(target, 'extendedWaitUntil', [], context);
  const timeoutMs = String(readTimeoutMs(value, 30000));
  if (value.notVisible !== undefined) {
    return [action('wait', [timeoutMs]), action('is', ['hidden', selector])];
  }
  return [action('wait', [selector, timeoutMs])];
}

export function convertScroll(value: unknown): SessionAction {
  if (value !== null && value !== undefined) {
    throw unsupportedMaestroSyntax('Maestro scroll options are not supported yet.');
  }
  return action('scroll', ['down']);
}

export function convertSwipe(value: unknown): SessionAction {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'swipe expects a map.');
  }
  assertOnlyKeys(value, 'swipe', ['start', 'end', 'duration']);
  if (typeof value.start !== 'string' || typeof value.end !== 'string') {
    throw unsupportedMaestroSyntax('Only Maestro swipe start/end coordinates are supported.');
  }
  const start = parseSwipePoint(value.start);
  const end = parseSwipePoint(value.end);
  const durationMs =
    typeof value.duration === 'number' && Number.isFinite(value.duration)
      ? String(Math.max(16, Math.floor(value.duration)))
      : undefined;
  if (start.kind === 'absolute' && end.kind === 'absolute') {
    return action('swipe', [
      String(start.x),
      String(start.y),
      String(end.x),
      String(end.y),
      ...(durationMs ? [durationMs] : []),
    ]);
  }
  if (start.kind === 'percent' && end.kind === 'percent') {
    return action('scroll', readScrollPositionalsFromPercentSwipe(start, end));
  }
  throw unsupportedMaestroSyntax(
    'Maestro swipe start/end must both be absolute pixels or both be percentages.',
  );
}

export function convertPressKey(value: unknown): SessionAction {
  const key = requireStringValue('pressKey', value).toLowerCase();
  if (key === 'back') return action('back');
  if (key === 'enter' || key === 'return') return action('press', ['return']);
  if (key === 'home') return action('home');
  throw unsupportedMaestroSyntax(`Maestro pressKey "${key}" is not supported yet.`);
}

export function maestroSelector(
  value: unknown,
  command: string,
  allowedExtraKeys: readonly string[] = [],
  context: MaestroParseContext,
): string {
  if (typeof value === 'string') return visibleTextSelector(resolveMaestroString(value, context));
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', `${command} expects a string or selector map.`);
  }
  assertOnlyKeys(value, command, ['id', 'text', 'enabled', 'selected', ...allowedExtraKeys]);

  const terms: string[] = [];
  if (typeof value.id === 'string')
    terms.push(selectorTerm('id', resolveMaestroString(value.id, context)));
  if (typeof value.text === 'string')
    terms.push(selectorTerm('label', resolveMaestroString(value.text, context)));
  if (typeof value.enabled === 'boolean')
    terms.push(selectorTerm('enabled', String(value.enabled)));
  if (typeof value.selected === 'boolean')
    terms.push(selectorTerm('selected', String(value.selected)));
  if (terms.length === 0) {
    throw new AppError(
      'INVALID_ARGS',
      `${command} selector map must include one of id, text, enabled, or selected.`,
    );
  }
  return terms.join(' ');
}

function visibleTextSelector(value: string): string {
  return [
    selectorTerm('label', value),
    selectorTerm('text', value),
    selectorTerm('id', value),
  ].join(' || ');
}

function selectorTerm(key: string, value: string): string {
  return `${key}=${JSON.stringify(value)}`;
}

function tapFlags(value: unknown): SessionAction['flags'] | undefined {
  if (!isPlainRecord(value)) return undefined;
  const flags: SessionAction['flags'] = {};
  if (typeof value.repeat === 'number' && Number.isInteger(value.repeat) && value.repeat > 1) {
    flags.count = value.repeat;
  }
  if (typeof value.delay === 'number' && Number.isInteger(value.delay) && value.delay >= 0) {
    flags.intervalMs = value.delay;
  }
  return Object.keys(flags).length > 0 ? flags : undefined;
}

function doubleTapFlags(value: unknown): SessionAction['flags'] {
  const flags: SessionAction['flags'] = { doubleTap: true };
  if (isPlainRecord(value) && typeof value.delay === 'number' && Number.isInteger(value.delay)) {
    flags.intervalMs = Math.max(0, value.delay);
  }
  return flags;
}

function parsePoint(value: string): { x: number; y: number } {
  const match = value.match(/^(\d+),(\d+)$/);
  if (!match) {
    throw unsupportedMaestroSyntax(
      'Only absolute Maestro point selectors like "100,200" are supported.',
    );
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

type SwipePoint =
  | {
      kind: 'absolute';
      x: number;
      y: number;
    }
  | {
      kind: 'percent';
      x: number;
      y: number;
    };

function parseSwipePoint(value: string): SwipePoint {
  const absolute = value.match(/^\s*(\d+)\s*,\s*(\d+)\s*$/);
  if (absolute) {
    return { kind: 'absolute', x: Number(absolute[1]), y: Number(absolute[2]) };
  }
  const percent = value.match(/^\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*$/);
  if (percent) {
    return { kind: 'percent', x: Number(percent[1]), y: Number(percent[2]) };
  }
  throw unsupportedMaestroSyntax(
    'Only Maestro swipe coordinates like "100,200" or "50%,75%" are supported.',
  );
}

function readScrollPositionalsFromPercentSwipe(
  start: Extract<SwipePoint, { kind: 'percent' }>,
  end: Extract<SwipePoint, { kind: 'percent' }>,
): string[] {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (Math.abs(deltaX) === 0 && Math.abs(deltaY) === 0) {
    throw new AppError('INVALID_ARGS', 'swipe start and end cannot be the same point.');
  }
  const vertical = Math.abs(deltaY) >= Math.abs(deltaX);
  const direction = vertical ? (deltaY < 0 ? 'down' : 'up') : deltaX < 0 ? 'right' : 'left';
  const amount = Math.min(1, Math.max(0.01, Math.abs(vertical ? deltaY : deltaX) / 100));
  return [direction, formatAmount(amount)];
}

function formatAmount(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
