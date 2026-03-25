import { AppError } from '../utils/errors.ts';

export type SessionSurface = 'app' | 'frontmost-app' | 'desktop' | 'menubar';

export const SESSION_SURFACES: readonly SessionSurface[] = [
  'app',
  'frontmost-app',
  'desktop',
  'menubar',
];

export const PHASE1_MACOS_SESSION_SURFACES: readonly SessionSurface[] = ['app', 'frontmost-app'];

export function isPhase1MacOsSessionSurface(surface: SessionSurface): boolean {
  return PHASE1_MACOS_SESSION_SURFACES.includes(surface);
}

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
