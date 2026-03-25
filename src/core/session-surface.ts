import { AppError } from '../utils/errors.ts';

export type SessionSurface = 'app' | 'frontmost-app' | 'desktop' | 'menubar';

export const SESSION_SURFACES: readonly SessionSurface[] = [
  'app',
  'frontmost-app',
  'desktop',
  'menubar',
];

export function parseSessionSurface(value: string | undefined): SessionSurface {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'app' ||
    normalized === 'frontmost-app' ||
    normalized === 'desktop' ||
    normalized === 'menubar'
  ) {
    return normalized;
  }
  throw new AppError(
    'INVALID_ARGS',
    `Invalid surface: ${value}. Use ${SESSION_SURFACES.join('|')}.`,
  );
}
