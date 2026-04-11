import type { CliFlags } from './command-schema.ts';
import {
  REMOTE_CONFIG_FIELD_SPECS,
  REMOTE_OPEN_PROFILE_KEYS,
  type RemoteConfigProfile,
} from '../remote-config-schema.ts';
import { resolveRemoteConfigProfile } from '../remote-config-core.ts';

// Remote config can supply defaults for any supported CLI flag that exists in the profile schema.
// Command validation later strips unsupported defaults for the active command.
const REMOTE_CONFIG_DEFAULT_FLAG_KEYS = REMOTE_CONFIG_FIELD_SPECS.map(
  (spec) => spec.key,
) as readonly (keyof RemoteConfigProfile)[];

// This subset is still intentional: open preserves extra remote-config defaults after command
// parsing so it can prepare remote Metro without exposing every Metro flag as an open CLI option.
export const REMOTE_OPEN_FLAG_KEYS = [
  'remoteConfig',
  ...REMOTE_OPEN_PROFILE_KEYS,
] as const satisfies readonly (keyof CliFlags)[];

function profileToCliFlags(profile: RemoteConfigProfile): Partial<CliFlags> {
  const flags: Partial<CliFlags> = {};
  for (const key of REMOTE_CONFIG_DEFAULT_FLAG_KEYS) {
    const value = profile[key];
    if (value !== undefined) {
      (flags as Record<string, unknown>)[key] = value;
    }
  }
  return flags;
}

export function resolveRemoteConfigDefaults(options: {
  remoteConfig?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}): Partial<CliFlags> {
  if (!options.remoteConfig) {
    return {};
  }

  const resolved = resolveRemoteConfigProfile({
    configPath: options.remoteConfig,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    ...profileToCliFlags(resolved.profile),
    remoteConfig: options.remoteConfig,
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
