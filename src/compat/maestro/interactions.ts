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
import {
  parseAbsolutePoint,
  parseMaestroPoint,
  readScrollPositionalsFromPercentSwipe,
} from './points.ts';
import { MAESTRO_RUNTIME_COMMAND } from './runtime-commands.ts';
import type { MaestroParseContext } from './types.ts';

export function convertTapOn(value: unknown, context: MaestroParseContext): SessionAction {
  if (typeof value === 'string') {
    return action(MAESTRO_RUNTIME_COMMAND.tapOn, [
      visibleTextSelector(resolveMaestroString(value, context)),
    ]);
  }
  if (isPlainRecord(value) && typeof value.point === 'string') {
    assertOnlyKeys(value, 'tapOn', ['point', 'repeat', 'delay']);
    const point = parseMaestroPoint(value.point);
    if (point.kind === 'percent') {
      return action(
        MAESTRO_RUNTIME_COMMAND.tapPointPercent,
        [String(point.x), String(point.y)],
        tapFlags(value),
      );
    }
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
    MAESTRO_RUNTIME_COMMAND.tapOn,
    [maestroSelector(value, 'tapOn', ['repeat', 'delay', 'optional', 'label'], context)],
    { ...tapFlags(value), allowNonHittableSelectorTap: true },
  );
}

export function convertDoubleTapOn(value: unknown, context: MaestroParseContext): SessionAction {
  if (isPlainRecord(value) && typeof value.point === 'string') {
    assertOnlyKeys(value, 'doubleTapOn', ['point', 'delay']);
    const point = parseAbsolutePoint(value.point);
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
    const point = parseAbsolutePoint(value.point);
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

export function convertScrollUntilVisible(
  value: unknown,
  context: MaestroParseContext,
): SessionAction[] {
  if (typeof value === 'string') {
    return [
      action(MAESTRO_RUNTIME_COMMAND.scrollUntilVisible, [
        visibleTextSelector(resolveMaestroString(value, context)),
        '5000',
        'down',
      ]),
    ];
  }
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'scrollUntilVisible expects a string or map.');
  }
  assertOnlyKeys(value, 'scrollUntilVisible', ['element', 'direction', 'timeout']);
  const selector = maestroSelector(value.element, 'scrollUntilVisible.element', [], context);
  const direction =
    typeof value.direction === 'string'
      ? readScrollPositionalsFromDirectionSwipe(value.direction)[0]
      : 'down';
  const timeoutMs = String(readTimeoutMs(value, 5000));
  return [action(MAESTRO_RUNTIME_COMMAND.scrollUntilVisible, [selector, timeoutMs, direction])];
}

export function convertSwipe(value: unknown): SessionAction {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'swipe expects a map.');
  }
  assertOnlyKeys(value, 'swipe', ['start', 'end', 'direction', 'duration']);
  if (typeof value.direction === 'string') {
    return action('scroll', readScrollPositionalsFromDirectionSwipe(value.direction));
  }
  if (typeof value.start !== 'string' || typeof value.end !== 'string') {
    throw unsupportedMaestroSyntax('Only Maestro swipe start/end coordinates are supported.');
  }
  const start = parseMaestroPoint(value.start);
  const end = parseMaestroPoint(value.end);
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

function readScrollPositionalsFromDirectionSwipe(direction: string): string[] {
  switch (direction.toLowerCase()) {
    case 'up':
      return ['down'];
    case 'down':
      return ['up'];
    case 'left':
      return ['right'];
    case 'right':
      return ['left'];
    default:
      throw unsupportedMaestroSyntax('Maestro swipe direction must be UP, DOWN, LEFT, or RIGHT.');
  }
}

export function convertPressKey(value: unknown): SessionAction {
  const key = requireStringValue('pressKey', value).toLowerCase();
  if (key === 'back') return action('back');
  if (key === 'enter' || key === 'return') return action(MAESTRO_RUNTIME_COMMAND.pressEnter);
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
  const repeat = positiveInteger(value.repeat);
  const delay = nonNegativeInteger(value.delay);
  if (repeat && repeat > 1) flags.count = repeat;
  if (delay !== undefined) flags.intervalMs = delay;
  if (value.optional === true) flags.maestroOptional = true;
  return Object.keys(flags).length > 0 ? flags : undefined;
}

function doubleTapFlags(value: unknown): SessionAction['flags'] {
  const flags: SessionAction['flags'] = { doubleTap: true };
  if (isPlainRecord(value) && typeof value.delay === 'number' && Number.isInteger(value.delay)) {
    flags.intervalMs = Math.max(0, value.delay);
  }
  return flags;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
