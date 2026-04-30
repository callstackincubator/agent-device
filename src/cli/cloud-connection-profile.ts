import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRemoteConfigProfile } from '../remote-config.ts';
import type { RemoteConfigProfile, ResolvedRemoteConfigProfile } from '../remote-config-schema.ts';
import { profileToCliFlags } from '../utils/remote-config.ts';
import { AppError, asAppError } from '../utils/errors.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { resolveCloudAccessForConnect } from './auth-session.ts';

const CONNECTION_PROFILE_PATH = '/api/control-plane/connection-profile';
const HTTP_TIMEOUT_MS = 15_000;

type CloudConnectionProfileResponse = {
  connection?: {
    remoteConfigProfile?: unknown;
  };
};

type EnvMap = Record<string, string | undefined>;

export async function resolveCloudConnectProfile(options: {
  flags: CliFlags;
  stateDir: string;
  cwd: string;
  env?: EnvMap;
  fetchImpl?: typeof fetch;
}): Promise<{ flags: CliFlags; remoteConfigPath: string }> {
  const auth = await resolveCloudAccessForConnect({
    stateDir: options.stateDir,
    flags: options.flags,
    env: options.env,
    io: {
      env: options.env,
      fetch: options.fetchImpl,
    },
  });
  const profile = await fetchConnectionProfile({
    cloudBaseUrl: auth.cloudBaseUrl,
    accessToken: auth.accessToken,
    fetchImpl: options.fetchImpl,
  });
  const remoteConfigPath = writeGeneratedRemoteConfig({
    stateDir: options.stateDir,
    profile,
  });
  const remoteConfig = resolveGeneratedRemoteConfigProfile({
    configPath: remoteConfigPath,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    flags: {
      ...profileToCliFlags(remoteConfig.profile),
      ...options.flags,
      remoteConfig: remoteConfig.resolvedPath,
      daemonAuthToken: auth.accessToken,
    },
    remoteConfigPath: remoteConfig.resolvedPath,
  };
}

async function fetchConnectionProfile(options: {
  cloudBaseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RemoteConfigProfile> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL(CONNECTION_PROFILE_PATH, options.cloudBaseUrl), {
    method: 'GET',
    headers: { authorization: `Bearer ${options.accessToken}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new AppError(
        'COMMAND_FAILED',
        `Cloud connection profile endpoint returned invalid JSON (${response.status}).`,
        { status: response.status },
        error instanceof Error ? error : undefined,
      );
    }
  }
  if (!response.ok) {
    throw new AppError('UNAUTHORIZED', 'Cloud connection profile endpoint rejected the request.', {
      status: response.status,
      response: parsed,
    });
  }
  return parseConnectionProfile(parsed);
}

function parseConnectionProfile(value: unknown): RemoteConfigProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('COMMAND_FAILED', 'Cloud connection profile response is invalid.');
  }
  const connection = (value as CloudConnectionProfileResponse).connection;
  if (!connection || typeof connection !== 'object') {
    throw new AppError('COMMAND_FAILED', 'Cloud connection profile response is missing profile.');
  }
  if (connection.remoteConfigProfile !== undefined) {
    return parseRemoteConfigProfile(connection.remoteConfigProfile);
  }
  throw new AppError(
    'COMMAND_FAILED',
    'Cloud connection profile did not include remoteConfigProfile.',
  );
}

function parseRemoteConfigProfile(value: unknown): RemoteConfigProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(
      'COMMAND_FAILED',
      'Cloud connection profile remoteConfigProfile is invalid.',
    );
  }
  if (Object.keys(value).length === 0) {
    throw new AppError('COMMAND_FAILED', 'Cloud connection profile remoteConfigProfile is empty.');
  }
  return value as RemoteConfigProfile;
}

function resolveGeneratedRemoteConfigProfile(options: {
  configPath: string;
  cwd: string;
  env?: EnvMap;
}): ResolvedRemoteConfigProfile {
  try {
    // Re-read the generated file to reuse the standard env merge, type coercion, and path resolution.
    return resolveRemoteConfigProfile(options);
  } catch (error) {
    const appError = asAppError(error);
    throw new AppError(
      'COMMAND_FAILED',
      'Cloud connection profile returned invalid remote config.',
      {
        generatedConfigPath: options.configPath,
        cause: appError.message,
      },
      appError,
    );
  }
}

function writeGeneratedRemoteConfig(options: {
  stateDir: string;
  profile: RemoteConfigProfile;
}): string {
  const normalized = normalizeJson(options.profile);
  const configDir = path.join(options.stateDir, 'remote-connections', 'generated');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const configPath = path.join(configDir, `cloud-${profileHash(normalized)}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX mode bits.
  }
  return configPath;
}

function profileHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeJson(entryValue)]),
    );
  }
  return value;
}
