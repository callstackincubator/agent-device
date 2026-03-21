import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AndroidToolName = 'adb' | 'avdmanager' | 'emulator' | 'sdkmanager';

const ANDROID_SDK_BIN_DIRS = [
  'emulator',
  'platform-tools',
  path.join('cmdline-tools', 'latest', 'bin'),
  path.join('cmdline-tools', 'tools', 'bin'),
] as const;

const ANDROID_TOOL_RELATIVE_PATHS: Record<AndroidToolName, readonly string[]> = {
  adb: [path.join('platform-tools', 'adb')],
  avdmanager: [
    path.join('cmdline-tools', 'latest', 'bin', 'avdmanager'),
    path.join('cmdline-tools', 'tools', 'bin', 'avdmanager'),
  ],
  emulator: [path.join('emulator', 'emulator')],
  sdkmanager: [
    path.join('cmdline-tools', 'latest', 'bin', 'sdkmanager'),
    path.join('cmdline-tools', 'tools', 'bin', 'sdkmanager'),
  ],
};

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

function resolvePathCommandCandidates(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (path.extname(command)) {
    return [command];
  }
  const pathExtEntries = (env.PATHEXT ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`));
  return uniqueNonEmpty([command, ...pathExtEntries.map((entry) => `${command}${entry}`)]);
}

async function hasCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const pathEntries = (env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const commandCandidates = resolvePathCommandCandidates(command, env);
  for (const entry of pathEntries) {
    for (const candidate of commandCandidates) {
      if (await pathExists(path.join(entry, candidate))) {
        return true;
      }
    }
  }
  return false;
}

export async function resolveAndroidToolPath(
  tool: AndroidToolName,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const sdkRoot of resolveAndroidSdkRoots(env)) {
    for (const relativePath of ANDROID_TOOL_RELATIVE_PATHS[tool]) {
      const candidate = path.join(sdkRoot, relativePath);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }
  return (await hasCommandOnPath(tool, env)) ? tool : undefined;
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
