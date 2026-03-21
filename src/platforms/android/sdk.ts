import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ANDROID_SDK_BIN_DIRS = [
  'emulator',
  'platform-tools',
  path.join('cmdline-tools', 'latest', 'bin'),
  path.join('cmdline-tools', 'tools', 'bin'),
] as const;

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function resolveAndroidSdkRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const configuredRoot = env.ANDROID_SDK_ROOT?.trim();
  const configuredHome = env.ANDROID_HOME?.trim();
  const homeDir = env.HOME?.trim() || os.homedir();
  const defaultRoot = homeDir ? path.join(homeDir, 'Android', 'Sdk') : '';
  return uniqueNonEmpty([configuredRoot ?? '', configuredHome ?? '', defaultRoot]);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureAndroidSdkPathConfigured(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const existingDirs: string[] = [];
  let detectedRoot: string | undefined;

  for (const sdkRoot of resolveAndroidSdkRoots(env)) {
    const presentDirs: string[] = [];
    for (const relativeDir of ANDROID_SDK_BIN_DIRS) {
      const candidate = path.join(sdkRoot, relativeDir);
      if (await pathExists(candidate)) {
        presentDirs.push(candidate);
      }
    }
    if (presentDirs.length === 0) continue;
    if (!detectedRoot) {
      detectedRoot = sdkRoot;
    }
    existingDirs.push(...presentDirs);
  }

  if (detectedRoot) {
    env.ANDROID_SDK_ROOT = env.ANDROID_SDK_ROOT?.trim() || detectedRoot;
    env.ANDROID_HOME = env.ANDROID_HOME?.trim() || detectedRoot;
  }

  if (existingDirs.length === 0) return;

  const currentEntries = (env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  env.PATH = uniqueNonEmpty([...existingDirs, ...currentEntries]).join(path.delimiter);
}
