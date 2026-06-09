import type { DeviceInfo } from '../../utils/device.ts';
import { parseWukongAppInfo } from './app-parsers.ts';
import { runHarmonyHdc } from './hdc.ts';

const LAUNCH_ABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

type LaunchAbilityCacheEntry = {
  fetchedAt: number;
  abilities: Map<string, string>;
};

const launchAbilityCache = new Map<string, LaunchAbilityCacheEntry>();

export function clearHarmonyLaunchAbilityCache(deviceId?: string): void {
  if (deviceId) {
    launchAbilityCache.delete(deviceId);
    return;
  }
  launchAbilityCache.clear();
}

export async function getHarmonyLaunchAbilities(device: DeviceInfo): Promise<Map<string, string>> {
  const cached = launchAbilityCache.get(device.id);
  if (cached && Date.now() - cached.fetchedAt < LAUNCH_ABILITY_CACHE_TTL_MS) {
    return cached.abilities;
  }

  const result = await runHarmonyHdc(device, ['shell', 'wukong', 'appinfo'], {
    allowFailure: true,
    timeoutMs: 15_000,
  });

  if (result.exitCode !== 0) {
    return cached?.abilities ?? new Map();
  }

  const abilities = parseWukongAppInfo(result.stdout);
  launchAbilityCache.set(device.id, {
    fetchedAt: Date.now(),
    abilities,
  });
  return abilities;
}

export async function lookupHarmonyLaunchAbility(
  device: DeviceInfo,
  bundleName: string,
): Promise<string | null> {
  const abilities = await getHarmonyLaunchAbilities(device);
  return abilities.get(bundleName) ?? null;
}
