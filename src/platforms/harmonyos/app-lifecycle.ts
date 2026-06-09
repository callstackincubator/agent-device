import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import type { BackendAppInfo, BackendAppState } from '../../backend.ts';
import type { AppsFilter } from '../../commands/app-inventory-contract.ts';
import { runHarmonyHdc } from './hdc.ts';
import { parseHarmonyBundleList, parseHarmonyForegroundAbility } from './app-parsers.ts';
import { dismissHarmonySystemDialogs } from './alert.ts';
import { lookupHarmonyLaunchAbility, getHarmonyLaunchAbilities } from './launch-abilities.ts';

export async function listHarmonyApps(
  device: DeviceInfo,
  _filter: AppsFilter,
): Promise<readonly BackendAppInfo[]> {
  const result = await runHarmonyHdc(device, ['shell', 'bm', 'dump', '-a'], {
    allowFailure: false,
    timeoutMs: 15_000,
  });

  const bundles = parseHarmonyBundleList(result.stdout);
  const launchAbilities = await getHarmonyLaunchAbilities(device);

  return bundles.map((bundle) => {
    const launchAbility = launchAbilities.get(bundle);
    return {
      id: bundle,
      name: bundle.split('.').pop() ?? bundle,
      bundleId: bundle,
      ...(launchAbility ? { activity: launchAbility } : {}),
    };
  });
}

export async function openHarmonyApp(
  device: DeviceInfo,
  bundleName: string,
  abilityName?: string,
  moduleName?: string,
): Promise<void> {
  // Check for screen lock first
  await checkAndHandleScreenLock(device);

  const resolved = await resolveHarmonyApp(device, bundleName);

  // Strategy 1: Try with specified ability if provided
  if (abilityName) {
    const success = await tryOpenWithAbility(device, resolved, abilityName, moduleName);
    if (success) {
      await handlePostLaunchDialogs(device);
      return;
    }
  }

  // Strategy 2: Resolve launch ability via wukong appinfo (DevEco / device catalog)
  const wukongAbility = await lookupHarmonyLaunchAbility(device, resolved);
  if (wukongAbility) {
    const successWukong = await tryOpenWithAbility(device, resolved, wukongAbility, moduleName);
    if (successWukong) {
      await handlePostLaunchDialogs(device);
      return;
    }
  }

  // Strategy 3: Try with MainAbility (common default)
  const successMain = await tryOpenWithAbility(device, resolved, 'MainAbility', moduleName);
  if (successMain) {
    await handlePostLaunchDialogs(device);
    return;
  }

  // Strategy 4: Try EntryAbility (common for third-party apps)
  const successEntry = await tryOpenWithAbility(device, resolved, 'EntryAbility', moduleName);
  if (successEntry) {
    await handlePostLaunchDialogs(device);
    return;
  }

  // Strategy 5: Try without specifying ability (let system decide)
  const successDefault = await tryOpenWithoutAbility(device, resolved, moduleName);
  if (successDefault) {
    await handlePostLaunchDialogs(device);
    return;
  }

  throw new AppError('COMMAND_FAILED', `Failed to open app ${resolved} after multiple attempts`);
}

async function tryOpenWithAbility(
  device: DeviceInfo,
  bundleName: string,
  abilityName: string,
  moduleName?: string,
): Promise<boolean> {
  // Try with the provided ability name
  let success = await attemptStartAbility(device, bundleName, abilityName, moduleName);
  if (success) return true;

  // If ability name doesn't include a dot, try with full qualified name
  if (!abilityName.includes('.')) {
    const fullAbilityName = `${bundleName}.${abilityName}`;
    success = await attemptStartAbility(device, bundleName, fullAbilityName, moduleName);
    if (success) return true;
  }

  return false;
}

async function attemptStartAbility(
  device: DeviceInfo,
  bundleName: string,
  abilityName: string,
  moduleName?: string,
): Promise<boolean> {
  const args = ['shell', 'aa', 'start', '-b', bundleName, '-a', abilityName];
  if (moduleName) {
    args.push('-m', moduleName);
  }

  try {
    const result = await runHarmonyHdc(device, args, { allowFailure: true, timeoutMs: 10_000 });
    if (result.exitCode === 0) {
      // Verify app is in foreground
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const state = await getHarmonyAppState(device);
      if (state.state === 'foreground' && state.bundleId === bundleName) {
        return true;
      }
    }
  } catch {
    // Ignore errors, will try next strategy
  }
  return false;
}

async function tryOpenWithoutAbility(
  device: DeviceInfo,
  bundleName: string,
  moduleName?: string,
): Promise<boolean> {
  const args = ['shell', 'aa', 'start', '-b', bundleName];
  if (moduleName) {
    args.push('-m', moduleName);
  }

  try {
    const result = await runHarmonyHdc(device, args, { allowFailure: true, timeoutMs: 10_000 });
    if (result.exitCode === 0) {
      // Verify app is in foreground
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const state = await getHarmonyAppState(device);
      if (state.state === 'foreground' && state.bundleId === bundleName) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  return false;
}

async function handlePostLaunchDialogs(device: DeviceInfo): Promise<void> {
  // Small delay to let any system dialogs appear
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Auto-dismiss common system dialogs
  await dismissHarmonySystemDialogs(device, 3);
}

async function checkAndHandleScreenLock(device: DeviceInfo): Promise<void> {
  try {
    // Check screen lock state via PowerManagerService
    const result = await runHarmonyHdc(
      device,
      ['shell', 'hidumper', '-s', 'PowerManagerService', '-a', '-s'],
      { allowFailure: true, timeoutMs: 5000 },
    );

    if (result.exitCode === 0) {
      const output = result.stdout.toLowerCase();
      if (output.includes('screen state: off') || output.includes('lock state: locked')) {
        // Try to wake up screen
        await runHarmonyHdc(device, ['shell', 'power-shell', 'wakeup'], { allowFailure: true });
        // Try to unlock (swipe up)
        await runHarmonyHdc(
          device,
          ['shell', 'uitest', 'uiInput', 'swipe', '540', '2000', '540', '800', '300'],
          { allowFailure: true },
        );
        // Wait for screen to wake
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Check again
        const recheck = await runHarmonyHdc(
          device,
          ['shell', 'hidumper', '-s', 'PowerManagerService', '-a', '-s'],
          { allowFailure: true, timeoutMs: 5000 },
        );
        if (recheck.stdout.toLowerCase().includes('lock state: locked')) {
          throw new AppError(
            'COMMAND_FAILED',
            'Device screen is locked and could not be automatically unlocked. Please unlock the device manually.',
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'COMMAND_FAILED') {
      throw error;
    }
    // If we can't check screen lock, proceed anyway
  }
}

export async function closeHarmonyApp(device: DeviceInfo, bundleName: string): Promise<void> {
  const resolved = await resolveHarmonyApp(device, bundleName);

  await runHarmonyHdc(device, ['shell', 'aa', 'force-stop', resolved], {
    allowFailure: true,
  });
}

export async function getHarmonyAppState(device: DeviceInfo): Promise<BackendAppState> {
  try {
    const result = await runHarmonyHdc(device, ['shell', 'aa', 'dump', '-l'], {
      allowFailure: true,
      timeoutMs: 10_000,
    });

    if (result.exitCode !== 0) {
      return { state: 'unknown' };
    }

    const foreground = parseHarmonyForegroundAbility(result.stdout);
    if (foreground) {
      return {
        bundleId: foreground.bundleName,
        state: 'foreground',
      };
    }

    return { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

async function resolveHarmonyApp(device: DeviceInfo, app: string): Promise<string> {
  // Known system app aliases
  const aliases: Record<string, string> = {
    settings: 'com.huawei.hmos.settings',
    'com.huawei.hmos.settings': 'com.huawei.hmos.settings',
    camera: 'com.huawei.hmos.camera',
    browser: 'com.huawei.hmos.browser',
    photos: 'com.huawei.hmos.photos',
    files: 'com.huawei.hmos.filemanager',
    notes: 'com.huawei.hmos.notes',
    calculator: 'com.huawei.hmos.calculator',
    clock: 'com.huawei.hmos.clock',
    weather: 'com.huawei.hmos.weather',
    calendar: 'com.huawei.hmos.calendar',
    contacts: 'com.huawei.hmos.contacts',
    phone: 'com.huawei.hmos.phone',
    messages: 'com.huawei.hmos.mms',
    appstore: 'com.huawei.hmos.appstore',
    callsetting: 'com.huawei.hmos.callsetting',
    communicationsetting: 'com.huawei.hmos.communicationsetting',
  };

  const lowerApp = app.toLowerCase();

  // Check aliases first
  if (aliases[lowerApp]) {
    return aliases[lowerApp];
  }

  // If it looks like a full bundle name, use it directly
  if (app.includes('.') && !app.includes(' ')) {
    return app;
  }

  // Try fuzzy match against installed bundles
  try {
    const result = await runHarmonyHdc(device, ['shell', 'bm', 'dump', '-a'], {
      allowFailure: true,
      timeoutMs: 10_000,
    });

    if (result.exitCode === 0) {
      const bundles = parseHarmonyBundleList(result.stdout);
      const lower = lowerApp;

      // Try substring match
      const match = bundles.find(
        (b) => b.toLowerCase().includes(lower) || b.toLowerCase().endsWith('.' + lower),
      );

      if (match) return match;
    }
  } catch {
    // Fall through to error
  }

  throw new AppError('APP_NOT_FOUND', `Could not resolve HarmonyOS app: ${app}`);
}

export async function installHarmonyApp(device: DeviceInfo, hapPath: string): Promise<void> {
  const result = await runHarmonyHdc(device, ['install', hapPath], {
    allowFailure: false,
    timeoutMs: 120_000,
  });

  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `Failed to install app: ${result.stderr}`);
  }
}

export async function reinstallHarmonyApp(
  device: DeviceInfo,
  bundleName: string,
  hapPath: string,
): Promise<{ bundleName: string }> {
  const resolved = await resolveHarmonyApp(device, bundleName).catch(() => bundleName);
  await uninstallHarmonyApp(device, resolved);
  await installHarmonyApp(device, hapPath);
  return { bundleName: resolved };
}

export async function uninstallHarmonyApp(device: DeviceInfo, bundleName: string): Promise<void> {
  await runHarmonyHdc(device, ['uninstall', bundleName], {
    allowFailure: true,
  });
}

/** Wipe app data/cache via `bm clean` (resets first-run state such as privacy consent). */
export async function clearHarmonyAppStorage(
  device: DeviceInfo,
  bundleName: string,
  options?: { data?: boolean; cache?: boolean },
): Promise<{ bundleId: string; clearedData: boolean; clearedCache: boolean }> {
  const resolved = await resolveHarmonyApp(device, bundleName);
  const clearData = options?.data !== false;
  const clearCache = options?.cache !== false;

  await runHarmonyHdc(device, ['shell', 'aa', 'force-stop', resolved], {
    allowFailure: true,
    timeoutMs: 10_000,
  });

  if (clearData) {
    const dataResult = await runHarmonyHdc(device, ['shell', 'bm', 'clean', '-n', resolved, '-d'], {
      allowFailure: false,
      timeoutMs: 30_000,
    });
    if (dataResult.exitCode !== 0) {
      throw new AppError(
        'COMMAND_FAILED',
        `Failed to clear HarmonyOS app data for ${resolved}: ${dataResult.stderr}`,
      );
    }
  }

  if (clearCache) {
    await runHarmonyHdc(device, ['shell', 'bm', 'clean', '-n', resolved, '-c'], {
      allowFailure: true,
      timeoutMs: 30_000,
    });
  }

  return { bundleId: resolved, clearedData: clearData, clearedCache: clearCache };
}
