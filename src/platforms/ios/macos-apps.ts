import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { parseAppearanceAction } from '../appearance.ts';
import { filterAppleAppsByBundlePrefix } from './app-filter.ts';
import { quitMacOsApp } from './macos-helper.ts';
import { readInfoPlistString } from './plist.ts';
import type { IosAppInfo } from './devicectl.ts';

const MACOS_ALIASES: Record<string, string> = {
  settings: 'com.apple.systempreferences',
};

const MACOS_BUNDLE_ID_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function _escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/"/g, '\\"');
}

function isMacOsBundleId(value: string): boolean {
  return MACOS_BUNDLE_ID_PATTERN.test(value);
}

function buildMacOpenArgs(bundleId: string, url?: string): string[] {
  const openArgs = ['-b', bundleId];
  if (url) {
    openArgs.push(url);
  }
  return openArgs;
}

async function readMacOsBundleInfo(
  appBundlePath: string,
): Promise<{ bundleId?: string; appName?: string }> {
  for (const infoPlistPath of [
    path.join(appBundlePath, 'Contents', 'Info.plist'),
    path.join(appBundlePath, 'Info.plist'),
  ]) {
    const [bundleId, displayName, bundleName] = await Promise.all([
      readInfoPlistString(infoPlistPath, 'CFBundleIdentifier'),
      readInfoPlistString(infoPlistPath, 'CFBundleDisplayName'),
      readInfoPlistString(infoPlistPath, 'CFBundleName'),
    ]);
    if (bundleId || displayName || bundleName) {
      return {
        bundleId,
        appName: displayName ?? bundleName,
      };
    }
  }
  return {};
}

export async function resolveMacOsApp(app: string): Promise<string> {
  const trimmed = app.trim();

  const alias = MACOS_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (isMacOsBundleId(trimmed)) {
    return trimmed;
  }

  const apps = await listMacApps('all');
  const matches = apps.filter((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
  if (matches.length === 1) return matches[0].bundleId;
  if (matches.length > 1) {
    throw new AppError('INVALID_ARGS', `Multiple apps matched "${app}"`, { matches });
  }

  throw new AppError('APP_NOT_INSTALLED', `No app found matching "${app}"`);
}

export async function openMacOsApp(
  _device: DeviceInfo,
  app: string,
  options?: { appBundleId?: string; url?: string },
): Promise<void> {
  const explicitUrl = options?.url?.trim();
  if (explicitUrl) {
    if (!isDeepLinkTarget(explicitUrl)) {
      throw new AppError('INVALID_ARGS', 'open <app> <url> requires a valid URL target');
    }
    const appId = options?.appBundleId ?? (await resolveMacOsApp(app));
    await runCmd('open', buildMacOpenArgs(appId, explicitUrl));
    return;
  }

  const target = app.trim();
  if (isDeepLinkTarget(target)) {
    await runCmd('open', [target]);
    return;
  }

  const bundleId = options?.appBundleId ?? (await resolveMacOsApp(target));
  await runCmd('open', buildMacOpenArgs(bundleId));
}

export async function closeMacOsApp(_device: DeviceInfo, app: string): Promise<void> {
  const bundleId = await resolveMacOsApp(app);
  const result = await quitMacOsApp(bundleId);
  if (!result.running || result.terminated || result.forceTerminated) return;
  throw new AppError('COMMAND_FAILED', `Failed to close macOS app ${app}`, {
    bundleId,
    running: result.running,
    terminated: result.terminated,
    forceTerminated: result.forceTerminated,
  });
}

export async function readMacOsClipboardText(): Promise<string> {
  const result = await runCmd('pbpaste', [], { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to read macOS clipboard', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
  return result.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

export async function writeMacOsClipboardText(text: string): Promise<void> {
  const result = await runCmd('pbcopy', [], {
    allowFailure: true,
    stdin: text,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to write macOS clipboard', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
}

async function getMacOsDarkModeEnabled(): Promise<boolean> {
  const script = 'tell application "System Events" to tell appearance preferences to get dark mode';
  const result = await runCmd('osascript', ['-e', script], { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to read macOS appearance', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
  const normalized = result.stdout.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new AppError(
    'COMMAND_FAILED',
    `Unable to determine current macOS appearance from osascript output: ${result.stdout.trim()}`,
  );
}

export async function setMacOsAppearance(state: string): Promise<void> {
  const action = parseAppearanceAction(state);
  const darkMode = action === 'toggle' ? !(await getMacOsDarkModeEnabled()) : action === 'dark';
  const script = `tell application "System Events" to tell appearance preferences to set dark mode to ${darkMode ? 'true' : 'false'}`;
  const result = await runCmd('osascript', ['-e', script], { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to set macOS appearance', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
}

export async function listMacApps(filter: 'user-installed' | 'all' = 'all'): Promise<IosAppInfo[]> {
  const appRoots = [
    '/Applications',
    '/System/Applications',
    path.join(os.homedir(), 'Applications'),
  ];
  const appPaths = new Set<string>();

  // TODO: Cache this inventory or switch to LaunchServices lookups if macOS app discovery becomes hot.
  for (const root of appRoots) {
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const result = await runCmd('find', [root, '-maxdepth', '4', '-type', 'd', '-name', '*.app'], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) continue;
    for (const line of result.stdout.split('\n')) {
      const candidate = line.trim();
      if (candidate) appPaths.add(candidate);
    }
  }

  const apps = await Promise.all(
    Array.from(appPaths).map(async (appPath) => {
      const bundleInfo = await readMacOsBundleInfo(appPath).catch(
        () =>
          ({}) as {
            bundleId?: string;
            appName?: string;
          },
      );
      const bundleId = bundleInfo.bundleId;
      if (!bundleId) return null;
      return {
        bundleId,
        name: bundleInfo.appName ?? path.basename(appPath, '.app'),
      } satisfies IosAppInfo;
    }),
  );

  return filterAppleAppsByBundlePrefix(
    apps
      .filter((app): app is IosAppInfo => app !== null)
      .sort((a, b) => a.name.localeCompare(b.name)),
    filter,
  );
}
