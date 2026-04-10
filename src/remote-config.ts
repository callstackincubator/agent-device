import { readEnvFlagDefaultsForKeys } from './utils/cli-config.ts';
import { mergeDefinedFlags } from './utils/merge-flags.ts';
import {
  loadRemoteConfigFile,
  REMOTE_CONFIG_KEYS,
  resolveRemoteConfigPath as resolveRemoteConfigFilePath,
} from './utils/remote-config.ts';

type EnvMap = Record<string, string | undefined>;

export type RemoteConfigProfile = {
  stateDir?: string;
  daemonBaseUrl?: string;
  daemonAuthToken?: string;
  daemonTransport?: 'auto' | 'socket' | 'http';
  daemonServerMode?: 'socket' | 'http' | 'dual';
  tenant?: string;
  sessionIsolation?: 'none' | 'tenant';
  runId?: string;
  leaseId?: string;
  platform?: 'ios' | 'macos' | 'android' | 'linux' | 'apple';
  target?: 'mobile' | 'tv' | 'desktop';
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
  session?: string;
  metroProjectRoot?: string;
  metroKind?: 'auto' | 'react-native' | 'expo';
  metroPublicBaseUrl?: string;
  metroProxyBaseUrl?: string;
  metroBearerToken?: string;
  metroPreparePort?: number;
  metroListenHost?: string;
  metroStatusHost?: string;
  metroStartupTimeoutMs?: number;
  metroProbeTimeoutMs?: number;
  metroRuntimeFile?: string;
  metroNoReuseExisting?: boolean;
  metroNoInstallDeps?: boolean;
};

export type RemoteConfigProfileOptions = {
  configPath: string;
  cwd: string;
  env?: EnvMap;
};

export type ResolvedRemoteConfigProfile = {
  resolvedPath: string;
  profile: RemoteConfigProfile;
};

const REMOTE_CONFIG_PROFILE_KEYS = [
  'stateDir',
  'daemonBaseUrl',
  'daemonAuthToken',
  'daemonTransport',
  'daemonServerMode',
  'tenant',
  'sessionIsolation',
  'runId',
  'leaseId',
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'iosSimulatorDeviceSet',
  'androidDeviceAllowlist',
  'session',
  'metroProjectRoot',
  'metroKind',
  'metroPublicBaseUrl',
  'metroProxyBaseUrl',
  'metroBearerToken',
  'metroPreparePort',
  'metroListenHost',
  'metroStatusHost',
  'metroStartupTimeoutMs',
  'metroProbeTimeoutMs',
  'metroRuntimeFile',
  'metroNoReuseExisting',
  'metroNoInstallDeps',
] as const satisfies readonly (keyof RemoteConfigProfile)[];

function normalizeRemoteConfigProfile(source: object): RemoteConfigProfile {
  const profile: RemoteConfigProfile = {};
  const values = source as Partial<Record<keyof RemoteConfigProfile, unknown>>;
  for (const key of REMOTE_CONFIG_PROFILE_KEYS) {
    const value = values[key];
    if (value !== undefined) {
      (profile as Record<string, unknown>)[key] = value;
    }
  }
  return profile;
}

export function resolveRemoteConfigPath(options: RemoteConfigProfileOptions): string {
  return resolveRemoteConfigFilePath(options);
}

function loadRemoteConfigProfile(options: RemoteConfigProfileOptions): ResolvedRemoteConfigProfile {
  const env = options.env ?? process.env;
  const resolvedPath = resolveRemoteConfigFilePath({
    configPath: options.configPath,
    cwd: options.cwd,
    env,
  });
  return {
    resolvedPath,
    profile: normalizeRemoteConfigProfile(
      loadRemoteConfigFile({
        configPath: options.configPath,
        cwd: options.cwd,
        env,
      }),
    ),
  };
}

function readRemoteConfigEnvDefaults(env: EnvMap = process.env): RemoteConfigProfile {
  return normalizeRemoteConfigProfile(readEnvFlagDefaultsForKeys(env, REMOTE_CONFIG_KEYS));
}

function mergeRemoteConfigProfile(
  ...profiles: Array<RemoteConfigProfile | null | undefined>
): RemoteConfigProfile {
  const merged: RemoteConfigProfile = {};
  for (const profile of profiles) {
    if (!profile) continue;
    mergeDefinedFlags(merged, profile);
  }
  return merged;
}

export function resolveRemoteConfigProfile(
  options: RemoteConfigProfileOptions,
): ResolvedRemoteConfigProfile {
  const envDefaults = readRemoteConfigEnvDefaults(options.env);
  const loaded = loadRemoteConfigProfile(options);
  return {
    resolvedPath: loaded.resolvedPath,
    profile: mergeRemoteConfigProfile(envDefaults, loaded.profile),
  };
}
