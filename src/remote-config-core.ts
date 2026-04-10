import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './utils/errors.ts';
import { mergeDefinedFlags } from './utils/merge-flags.ts';
import { resolveUserPath } from './utils/path-resolution.ts';

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

type RemoteConfigFieldSpec = {
  key: keyof RemoteConfigProfile;
  type: 'string' | 'int' | 'boolean' | 'enum';
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  path?: boolean;
};

const LEGACY_ENV_VAR_NAMES: Partial<Record<keyof RemoteConfigProfile, readonly string[]>> = {
  iosSimulatorDeviceSet: ['IOS_SIMULATOR_DEVICE_SET'],
  androidDeviceAllowlist: ['ANDROID_DEVICE_ALLOWLIST'],
  metroBearerToken: ['AGENT_DEVICE_PROXY_TOKEN'],
};

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const REMOTE_CONFIG_FIELD_SPECS = [
  { key: 'stateDir', type: 'string', path: true },
  { key: 'daemonBaseUrl', type: 'string' },
  { key: 'daemonAuthToken', type: 'string' },
  { key: 'daemonTransport', type: 'enum', enumValues: ['auto', 'socket', 'http'] },
  { key: 'daemonServerMode', type: 'enum', enumValues: ['socket', 'http', 'dual'] },
  { key: 'tenant', type: 'string' },
  { key: 'sessionIsolation', type: 'enum', enumValues: ['none', 'tenant'] },
  { key: 'runId', type: 'string' },
  { key: 'leaseId', type: 'string' },
  { key: 'platform', type: 'enum', enumValues: ['ios', 'macos', 'android', 'linux', 'apple'] },
  { key: 'target', type: 'enum', enumValues: ['mobile', 'tv', 'desktop'] },
  { key: 'device', type: 'string' },
  { key: 'udid', type: 'string' },
  { key: 'serial', type: 'string' },
  { key: 'iosSimulatorDeviceSet', type: 'string', path: true },
  { key: 'androidDeviceAllowlist', type: 'string' },
  { key: 'session', type: 'string' },
  { key: 'metroProjectRoot', type: 'string', path: true },
  { key: 'metroKind', type: 'enum', enumValues: ['auto', 'react-native', 'expo'] },
  { key: 'metroPublicBaseUrl', type: 'string' },
  { key: 'metroProxyBaseUrl', type: 'string' },
  { key: 'metroBearerToken', type: 'string' },
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

export const REMOTE_OPEN_PROFILE_KEYS = [
  'session',
  'platform',
  'daemonBaseUrl',
  'daemonAuthToken',
  'daemonTransport',
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

function buildPrimaryEnvVarName(key: keyof RemoteConfigProfile): string {
  return `AGENT_DEVICE_${key
    .replace(/([A-Z])/g, '_$1')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase()}`;
}

function getEnvNames(key: keyof RemoteConfigProfile): string[] {
  return [buildPrimaryEnvVarName(key), ...(LEGACY_ENV_VAR_NAMES[key] ?? [])];
}

function parseBooleanLiteral(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function parseRemoteConfigValue(
  spec: RemoteConfigFieldSpec,
  value: unknown,
  sourceLabel: string,
  rawKey: string,
): unknown {
  if (spec.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const parsed = parseBooleanLiteral(value);
      if (parsed !== undefined) return parsed;
    }
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean.`,
    );
  }

  if (spec.type === 'string') {
    if (typeof value === 'string' && value.trim().length > 0) return value;
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected non-empty string.`,
    );
  }

  if (spec.type === 'enum') {
    if (typeof value === 'string' && spec.enumValues?.includes(value)) {
      return value;
    }
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected one of: ${spec.enumValues?.join(', ')}.`,
    );
  }

  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected integer.`,
    );
  }
  if (typeof spec.min === 'number' && parsed < spec.min) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Must be >= ${spec.min}.`,
    );
  }
  if (typeof spec.max === 'number' && parsed > spec.max) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Must be <= ${spec.max}.`,
    );
  }
  return parsed;
}

function readRemoteConfigFile(options: RemoteConfigProfileOptions): ResolvedRemoteConfigProfile {
  const env = options.env ?? process.env;
  const resolvedPath = resolveRemoteConfigPath(options);
  if (!fs.existsSync(resolvedPath)) {
    throw new AppError('INVALID_ARGS', `Remote config file not found: ${resolvedPath}`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    throw new AppError('INVALID_ARGS', `Failed to read remote config file: ${resolvedPath}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AppError('INVALID_ARGS', `Invalid JSON in remote config file: ${resolvedPath}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(
      'INVALID_ARGS',
      `Remote config file must contain a JSON object: ${resolvedPath}`,
    );
  }

  const profile: RemoteConfigProfile = {};
  const source = parsed as Record<string, unknown>;
  const configDir = path.dirname(resolvedPath);
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const spec = remoteConfigFieldSpecByKey.get(rawKey as keyof RemoteConfigProfile);
    if (!spec) {
      throw new AppError(
        'INVALID_ARGS',
        `Unsupported remote config key "${rawKey}" in remote config file ${resolvedPath}.`,
      );
    }
    const parsedValue = parseRemoteConfigValue(
      spec,
      rawValue,
      `remote config file ${resolvedPath}`,
      rawKey,
    );
    (profile as Record<string, unknown>)[spec.key] =
      typeof parsedValue === 'string' && 'path' in spec && spec.path
        ? resolveUserPath(parsedValue, { cwd: configDir, env })
        : parsedValue;
  }

  return { resolvedPath, profile };
}

function readRemoteConfigEnvDefaults(env: EnvMap = process.env): RemoteConfigProfile {
  const profile: RemoteConfigProfile = {};
  for (const spec of REMOTE_CONFIG_FIELD_SPECS) {
    const envMatch = getEnvNames(spec.key)
      .map((name) => ({ name, value: env[name] }))
      .find((entry) => typeof entry.value === 'string' && entry.value.trim().length > 0);
    if (!envMatch) continue;
    (profile as Record<string, unknown>)[spec.key] = parseRemoteConfigValue(
      spec,
      envMatch.value,
      `environment variable ${envMatch.name}`,
      envMatch.name,
    );
  }
  return profile;
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

export function resolveRemoteConfigPath(options: RemoteConfigProfileOptions): string {
  const env = options.env ?? process.env;
  return resolveUserPath(options.configPath, { cwd: options.cwd, env });
}

export function resolveRemoteConfigProfile(
  options: RemoteConfigProfileOptions,
): ResolvedRemoteConfigProfile {
  const loaded = readRemoteConfigFile(options);
  return {
    resolvedPath: loaded.resolvedPath,
    profile: mergeRemoteConfigProfile(readRemoteConfigEnvDefaults(options.env), loaded.profile),
  };
}
