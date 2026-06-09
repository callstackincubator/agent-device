import { parseStringMember } from '../utils/string-enum.ts';

export const SESSION_SURFACES = ['app', 'frontmost-app', 'desktop', 'menubar'] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

export function parseSessionSurface(value: string | undefined): SessionSurface {
  return parseStringMember(SESSION_SURFACES, value, {
    normalize: (raw) => raw.trim().toLowerCase(),
    message: `Invalid surface: ${value}. Use ${SESSION_SURFACES.join('|')}.`,
  });
}
