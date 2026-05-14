import { resolveUserPath } from '../utils/path-resolution.ts';

export function safeSessionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function expandSessionPath(filePath: string, cwd?: string): string {
  return resolveUserPath(filePath, { cwd });
}
