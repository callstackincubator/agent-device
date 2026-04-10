import type { CliFlags } from './command-schema.ts';
import {
  REMOTE_OPEN_PROFILE_KEYS,
  resolveRemoteConfigProfile,
  type RemoteConfigProfile,
} from '../remote-config-core.ts';

export const REMOTE_OPEN_FLAG_KEYS = [
  'remoteConfig',
  ...REMOTE_OPEN_PROFILE_KEYS,
] as const satisfies readonly (keyof CliFlags)[];

function profileToCliFlags(profile: RemoteConfigProfile): Partial<CliFlags> {
  const flags: Partial<CliFlags> = {};
  for (const key of REMOTE_OPEN_PROFILE_KEYS) {
    const value = profile[key];
    if (value !== undefined) {
      (flags as Record<string, unknown>)[key] = value;
    }
  }
  return flags;
}

export function resolveRemoteConfigDefaults(options: {
  cliFlags: CliFlags;
  cwd: string;
  env: Record<string, string | undefined>;
}): Partial<CliFlags> {
  if (!options.cliFlags.remoteConfig) {
    return {};
  }

  const resolved = resolveRemoteConfigProfile({
    configPath: options.cliFlags.remoteConfig,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    ...profileToCliFlags(resolved.profile),
    remoteConfig: options.cliFlags.remoteConfig,
  };
}

export function pickRemoteOpenDefaults(defaultFlags: Partial<CliFlags>): Partial<CliFlags> {
  const retained: Partial<CliFlags> = {};
  for (const key of REMOTE_OPEN_FLAG_KEYS) {
    const value = defaultFlags[key];
    if (value !== undefined) {
      (retained as Record<string, unknown>)[key] = value;
    }
  }
  return retained;
}
