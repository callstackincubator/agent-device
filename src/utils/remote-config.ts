import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.ts';
import type { CliFlags } from './command-schema.ts';
import { getOptionSpec, parseOptionValueFromSource } from './cli-option-schema.ts';
import { resolveUserPath } from './path-resolution.ts';
import { readEnvFlagDefaultsForKeys } from './cli-config.ts';

type EnvMap = Record<string, string | undefined>;

const REMOTE_CONFIG_KEYS = [
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
] as const satisfies readonly (keyof CliFlags)[];

const REMOTE_CONFIG_PATH_KEYS = new Set<keyof CliFlags>([
  'stateDir',
  'iosSimulatorDeviceSet',
  'metroProjectRoot',
  'metroRuntimeFile',
]);

export const REMOTE_OPEN_FLAG_KEYS = [
  'remoteConfig',
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
] as const satisfies readonly (keyof CliFlags)[];

export function loadRemoteConfigFile(options: {
  configPath: string;
  cwd: string;
  env?: EnvMap;
}): Partial<CliFlags> {
  const env = options.env ?? process.env;
  const resolvedPath = resolveUserPath(options.configPath, { cwd: options.cwd, env });
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

  const flags: Partial<CliFlags> = {};
  const source = parsed as Record<string, unknown>;
  const configDir = path.dirname(resolvedPath);
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (!REMOTE_CONFIG_KEYS.includes(rawKey as (typeof REMOTE_CONFIG_KEYS)[number])) {
      throw new AppError(
        'INVALID_ARGS',
        `Unsupported remote config key "${rawKey}" in remote config file ${resolvedPath}.`,
      );
    }
    const key = rawKey as (typeof REMOTE_CONFIG_KEYS)[number];
    const spec = getOptionSpec(key);
    if (!spec) {
      throw new AppError(
        'INVALID_ARGS',
        `Unknown remote config key "${rawKey}" in remote config file ${resolvedPath}.`,
      );
    }
    const parsedValue = parseOptionValueFromSource(
      spec,
      rawValue,
      `remote config file ${resolvedPath}`,
      rawKey,
    );
    (flags as Record<string, unknown>)[key] =
      typeof parsedValue === 'string' && REMOTE_CONFIG_PATH_KEYS.has(key)
        ? resolveUserPath(parsedValue, { cwd: configDir, env })
        : parsedValue;
  }
  return flags;
}

export function resolveRemoteOpenDefaults(options: {
  command?: string;
  cliFlags: CliFlags;
  cwd: string;
  env: EnvMap;
}): Partial<CliFlags> {
  if (options.command !== 'open' || !options.cliFlags.remoteConfig) {
    return {};
  }

  const defaults = readEnvFlagDefaultsForKeys(options.env, REMOTE_OPEN_FLAG_KEYS);
  mergeDefinedFlags(
    defaults,
    loadRemoteConfigFile({
      configPath: options.cliFlags.remoteConfig,
      cwd: options.cwd,
      env: options.env,
    }),
  );
  defaults.remoteConfig = options.cliFlags.remoteConfig;
  return defaults;
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

function mergeDefinedFlags<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target[key as keyof T] = value as T[keyof T];
    }
  }
  return target;
}
