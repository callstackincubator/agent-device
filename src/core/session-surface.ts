import { AppError } from '../utils/errors.ts';

export const SESSION_SURFACES = ['app', 'frontmost-app', 'desktop', 'menubar'] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

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
