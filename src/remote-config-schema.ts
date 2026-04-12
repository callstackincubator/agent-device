import { buildPrimaryEnvVarName } from './utils/source-value.ts';

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
  leaseBackend?: 'ios-simulator' | 'ios-instance' | 'android-instance';
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
  env?: Record<string, string | undefined>;
};

export type ResolvedRemoteConfigProfile = {
  resolvedPath: string;
  profile: RemoteConfigProfile;
};

export type RemoteConfigFieldSpec = {
  key: keyof RemoteConfigProfile;
  type: 'string' | 'int' | 'boolean' | 'enum';
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  path?: boolean;
  legacyEnvNames?: readonly string[];
};

export const REMOTE_CONFIG_FIELD_SPECS = [
  { key: 'stateDir', type: 'string', path: true },
  { key: 'daemonBaseUrl', type: 'string' },
  { key: 'daemonAuthToken', type: 'string' },
  { key: 'daemonTransport', type: 'enum', enumValues: ['auto', 'socket', 'http'] },
  { key: 'daemonServerMode', type: 'enum', enumValues: ['socket', 'http', 'dual'] },
  { key: 'tenant', type: 'string' },
  { key: 'sessionIsolation', type: 'enum', enumValues: ['none', 'tenant'] },
  { key: 'runId', type: 'string' },
  { key: 'leaseId', type: 'string' },
  {
    key: 'leaseBackend',
    type: 'enum',
    enumValues: ['ios-simulator', 'ios-instance', 'android-instance'],
  },
  { key: 'platform', type: 'enum', enumValues: ['ios', 'macos', 'android', 'linux', 'apple'] },
  { key: 'target', type: 'enum', enumValues: ['mobile', 'tv', 'desktop'] },
  { key: 'device', type: 'string' },
  { key: 'udid', type: 'string' },
  { key: 'serial', type: 'string' },
  {
    key: 'iosSimulatorDeviceSet',
    type: 'string',
    path: true,
    legacyEnvNames: ['IOS_SIMULATOR_DEVICE_SET'],
  },
  {
    key: 'androidDeviceAllowlist',
    type: 'string',
    legacyEnvNames: ['ANDROID_DEVICE_ALLOWLIST'],
  },
  { key: 'session', type: 'string' },
  { key: 'metroProjectRoot', type: 'string', path: true },
  { key: 'metroKind', type: 'enum', enumValues: ['auto', 'react-native', 'expo'] },
  { key: 'metroPublicBaseUrl', type: 'string' },
  { key: 'metroProxyBaseUrl', type: 'string' },
  {
    key: 'metroBearerToken',
    type: 'string',
    legacyEnvNames: ['AGENT_DEVICE_PROXY_TOKEN'],
  },
  { key: 'metroPreparePort', type: 'int', min: 1, max: 65535 },
  { key: 'metroListenHost', type: 'string' },
  { key: 'metroStatusHost', type: 'string' },
  { key: 'metroStartupTimeoutMs', type: 'int', min: 1 },
  { key: 'metroProbeTimeoutMs', type: 'int', min: 1 },
  { key: 'metroRuntimeFile', type: 'string', path: true },
  { key: 'metroNoReuseExisting', type: 'boolean' },
  { key: 'metroNoInstallDeps', type: 'boolean' },
] as const satisfies readonly RemoteConfigFieldSpec[];

const remoteConfigFieldSpecByKey = new Map(
  REMOTE_CONFIG_FIELD_SPECS.map((spec) => [spec.key, spec]),
);

export function getRemoteConfigFieldSpec(
  key: keyof RemoteConfigProfile,
): RemoteConfigFieldSpec | undefined {
  return remoteConfigFieldSpecByKey.get(key);
}

export function getRemoteConfigEnvNames(key: keyof RemoteConfigProfile): string[] {
  const spec = getRemoteConfigFieldSpec(key);
  return [buildPrimaryEnvVarName(key), ...(spec?.legacyEnvNames ?? [])];
}
