import { AppError } from '../../utils/errors.ts';
import { unsupportedMaestroSyntax } from './support.ts';

export type MaestroPoint =
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

export function parseAbsolutePoint(value: string): { x: number; y: number } {
  const match = value.match(/^(\d+),(\d+)$/);
  if (!match) {
    throw unsupportedMaestroSyntax(
      'Only absolute Maestro point selectors like "100,200" are supported.',
    );
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function parseMaestroPoint(value: string): MaestroPoint {
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

export function readScrollPositionalsFromPercentSwipe(
  start: Extract<MaestroPoint, { kind: 'percent' }>,
  end: Extract<MaestroPoint, { kind: 'percent' }>,
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
