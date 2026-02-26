const IOS_SIMULATOR_DEVICE_SET_ENV_KEYS = [
  'AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET',
  'IOS_SIMULATOR_DEVICE_SET',
] as const;

const ANDROID_DEVICE_ALLOWLIST_ENV_KEYS = [
  'AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST',
  'ANDROID_DEVICE_ALLOWLIST',
] as const;

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveFirstEnv(
  keys: readonly string[],
  env: NodeJS.ProcessEnv,
): string | undefined {
  for (const key of keys) {
    const value = normalizeNonEmpty(env[key]);
    if (value) return value;
  }
  return undefined;
}

export function resolveIosSimulatorDeviceSetPath(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return normalizeNonEmpty(flagValue) ?? resolveFirstEnv(IOS_SIMULATOR_DEVICE_SET_ENV_KEYS, env);
}

export function parseSerialAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function resolveAndroidSerialAllowlist(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> | undefined {
  const configured =
    normalizeNonEmpty(flagValue)
    ?? resolveFirstEnv(ANDROID_DEVICE_ALLOWLIST_ENV_KEYS, env);
  if (!configured) return undefined;
  return parseSerialAllowlist(configured);
}
