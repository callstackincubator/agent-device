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

export type LoadRemoteConfigProfileOptions = {
  configPath: string;
  cwd: string;
  env?: EnvMap;
};

export type LoadRemoteConfigProfileResult = {
  resolvedPath: string;
  profile: RemoteConfigProfile;
};

export function resolveRemoteConfigPath(options: LoadRemoteConfigProfileOptions): string {
  return resolveRemoteConfigFilePath(options);
}

export function loadRemoteConfigProfile(
  options: LoadRemoteConfigProfileOptions,
): LoadRemoteConfigProfileResult {
  const env = options.env ?? process.env;
  const resolvedPath = resolveRemoteConfigFilePath({
    configPath: options.configPath,
    cwd: options.cwd,
    env,
  });
  return {
    resolvedPath,
    profile: loadRemoteConfigFile({
      configPath: options.configPath,
      cwd: options.cwd,
      env,
    }) as RemoteConfigProfile,
  };
}

export function readRemoteConfigEnvDefaults(env: EnvMap = process.env): RemoteConfigProfile {
  return readEnvFlagDefaultsForKeys(env, REMOTE_CONFIG_KEYS) as RemoteConfigProfile;
}

export function mergeRemoteConfigProfile(
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
  options: LoadRemoteConfigProfileOptions,
): LoadRemoteConfigProfileResult {
  const envDefaults = readRemoteConfigEnvDefaults(options.env);
  const loaded = loadRemoteConfigProfile(options);
  return {
    resolvedPath: loaded.resolvedPath,
    profile: mergeRemoteConfigProfile(envDefaults, loaded.profile),
  };
}
