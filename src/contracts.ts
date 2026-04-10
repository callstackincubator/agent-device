// Keep this public daemon contract shape aligned with MetroRuntimeHints in src/metro.ts
// and the internal MetroRuntimeHints in src/client-metro.ts.
export type SessionRuntimeHints = {
  platform?: 'ios' | 'android';
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  launchUrl?: string;
};

export type DaemonInstallSource =
  | {
      kind: 'url';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      kind: 'path';
      path: string;
    };

export type DaemonLockPolicy = 'reject' | 'strip';

export type DaemonRequestMeta = {
  requestId?: string;
  debug?: boolean;
  cwd?: string;
  tenantId?: string;
  runId?: string;
  leaseId?: string;
  leaseTtlMs?: number;
  leaseBackend?: 'ios-simulator';
  sessionIsolation?: 'none' | 'tenant';
  uploadedArtifactId?: string;
  clientArtifactPaths?: Record<string, string>;
  installSource?: DaemonInstallSource;
  retainMaterializedPaths?: boolean;
  materializedPathRetentionMs?: number;
  materializationId?: string;
  lockPolicy?: DaemonLockPolicy;
  lockPlatform?: 'ios' | 'macos' | 'android' | 'linux' | 'apple';
};

export type DaemonRequest = {
  token: string;
  session: string;
  command: string;
  positionals: string[];
  flags?: Record<string, unknown>;
  runtime?: SessionRuntimeHints;
  meta?: DaemonRequestMeta;
};

export type DaemonArtifact = {
  field: string;
  artifactId?: string;
  fileName?: string;
  localPath?: string;
  path?: string;
};

export type DaemonResponseData = Record<string, unknown> & {
  artifacts?: DaemonArtifact[];
};

export type DaemonError = {
  code: string;
  message: string;
  hint?: string;
  diagnosticId?: string;
  logPath?: string;
  details?: Record<string, unknown>;
};

export type DaemonResponse =
  | {
      ok: true;
      data?: DaemonResponseData;
    }
  | {
      ok: false;
      error: DaemonError;
    };

export type LeaseAllocatePayload = {
  token?: string;
  session?: string;
  tenantId?: string;
  tenant?: string;
  runId?: string;
  ttlMs?: number;
  backend?: 'ios-simulator';
};

export type LeaseHeartbeatPayload = {
  token?: string;
  session?: string;
  leaseId?: string;
  ttlMs?: number;
};

export type LeaseReleasePayload = {
  token?: string;
  session?: string;
  leaseId?: string;
};

export type JsonRpcId = string | number | null;

export type JsonRpcRequestEnvelope<TParams = unknown> = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: TParams;
};

type RuntimeSchema<T> = {
  parse(input: unknown): T;
};

// Keep the public contracts entrypoint dependency-free. These schemas exist so bridge/cloud
// consumers can validate shared payloads without pulling in an additional runtime library.
function schema<T>(parse: (input: unknown, path: string) => T): RuntimeSchema<T> {
  return {
    parse(input: unknown): T {
      return parse(input, '$');
    },
  };
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function expectObject(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(path, 'Expected an object');
  }
  return input as Record<string, unknown>;
}

function expectString(input: unknown, path: string): string {
  if (typeof input !== 'string') {
    fail(path, 'Expected a string');
  }
  return input;
}

function expectInteger(input: unknown, path: string): number {
  if (!Number.isInteger(input)) {
    fail(path, 'Expected an integer');
  }
  return input as number;
}

function expectArray(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) {
    fail(path, 'Expected an array');
  }
  return input;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = record[key];
  return value === undefined ? undefined : expectString(value, `${path}.${key}`);
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    fail(`${path}.${key}`, 'Expected a boolean');
  }
  return value;
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = record[key];
  return value === undefined ? undefined : expectInteger(value, `${path}.${key}`);
}

function optionalObject(
  record: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return value === undefined ? undefined : expectObject(value, `${path}.${key}`);
}

function optionalEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${path}.${key}`, `Expected one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function expectStringRecord(input: unknown, path: string): Record<string, string> {
  const record = expectObject(input, path);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = expectString(value, `${path}.${key}`);
  }
  return result;
}

function parseDaemonInstallSource(input: unknown, path: string): DaemonInstallSource {
  const record = expectObject(input, path);
  const kind = expectString(record.kind, `${path}.kind`);
  if (kind === 'url') {
    const url = expectString(record.url, `${path}.url`);
    const headers =
      record.headers === undefined
        ? undefined
        : expectStringRecord(record.headers, `${path}.headers`);
    return headers ? { kind, url, headers } : { kind, url };
  }
  if (kind === 'path') {
    return {
      kind,
      path: expectString(record.path, `${path}.path`),
    };
  }
  fail(`${path}.kind`, 'Expected "url" or "path"');
}

export const daemonRuntimeSchema = schema<SessionRuntimeHints>((input, path) => {
  const record = expectObject(input, path);
  return {
    platform: optionalEnum(record, 'platform', ['ios', 'android'] as const, path),
    metroHost: optionalString(record, 'metroHost', path),
    metroPort: optionalInteger(record, 'metroPort', path),
    bundleUrl: optionalString(record, 'bundleUrl', path),
    launchUrl: optionalString(record, 'launchUrl', path),
  };
});

export const daemonCommandRequestSchema = schema<DaemonRequest>((input, path) => {
  const record = expectObject(input, path);
  const rawPositionals = expectArray(record.positionals, `${path}.positionals`);
  const meta = optionalObject(record, 'meta', path);
  return {
    token: expectString(record.token, `${path}.token`),
    session: expectString(record.session, `${path}.session`),
    command: expectString(record.command, `${path}.command`),
    positionals: rawPositionals.map((value, index) =>
      expectString(value, `${path}.positionals[${String(index)}]`),
    ),
    flags: optionalObject(record, 'flags', path),
    runtime: record.runtime === undefined ? undefined : daemonRuntimeSchema.parse(record.runtime),
    meta:
      meta === undefined
        ? undefined
        : {
            requestId: optionalString(meta, 'requestId', `${path}.meta`),
            debug: optionalBoolean(meta, 'debug', `${path}.meta`),
            cwd: optionalString(meta, 'cwd', `${path}.meta`),
            tenantId: optionalString(meta, 'tenantId', `${path}.meta`),
            runId: optionalString(meta, 'runId', `${path}.meta`),
            leaseId: optionalString(meta, 'leaseId', `${path}.meta`),
            leaseTtlMs: optionalInteger(meta, 'leaseTtlMs', `${path}.meta`),
            leaseBackend: optionalEnum(
              meta,
              'leaseBackend',
              ['ios-simulator'] as const,
              `${path}.meta`,
            ),
            sessionIsolation: optionalEnum(
              meta,
              'sessionIsolation',
              ['none', 'tenant'] as const,
              `${path}.meta`,
            ),
            uploadedArtifactId: optionalString(meta, 'uploadedArtifactId', `${path}.meta`),
            clientArtifactPaths:
              meta.clientArtifactPaths === undefined
                ? undefined
                : expectStringRecord(meta.clientArtifactPaths, `${path}.meta.clientArtifactPaths`),
            installSource:
              meta.installSource === undefined
                ? undefined
                : parseDaemonInstallSource(meta.installSource, `${path}.meta.installSource`),
            retainMaterializedPaths: optionalBoolean(
              meta,
              'retainMaterializedPaths',
              `${path}.meta`,
            ),
            materializedPathRetentionMs: optionalInteger(
              meta,
              'materializedPathRetentionMs',
              `${path}.meta`,
            ),
            materializationId: optionalString(meta, 'materializationId', `${path}.meta`),
            lockPolicy: optionalEnum(
              meta,
              'lockPolicy',
              ['reject', 'strip'] as const,
              `${path}.meta`,
            ),
            lockPlatform: optionalEnum(
              meta,
              'lockPlatform',
              ['ios', 'macos', 'android', 'linux', 'apple'] as const,
              `${path}.meta`,
            ),
          },
  };
});

function parseLeaseCommon(
  input: unknown,
  path: string,
): {
  token?: string;
  session?: string;
  leaseId?: string;
  ttlMs?: number;
} {
  const record = expectObject(input, path);
  return {
    token: optionalString(record, 'token', path),
    session: optionalString(record, 'session', path),
    leaseId: optionalString(record, 'leaseId', path),
    ttlMs: optionalInteger(record, 'ttlMs', path),
  };
}

export const leaseAllocateSchema = schema<LeaseAllocatePayload>((input, path) => {
  const record = expectObject(input, path);
  return {
    token: optionalString(record, 'token', path),
    session: optionalString(record, 'session', path),
    tenantId: optionalString(record, 'tenantId', path),
    tenant: optionalString(record, 'tenant', path),
    runId: optionalString(record, 'runId', path),
    ttlMs: optionalInteger(record, 'ttlMs', path),
    backend: optionalEnum(record, 'backend', ['ios-simulator'] as const, path),
  };
});

export const leaseHeartbeatSchema = schema<LeaseHeartbeatPayload>((input, path) =>
  parseLeaseCommon(input, path),
);

export const leaseReleaseSchema = schema<LeaseReleasePayload>((input, path) => {
  const record = expectObject(input, path);
  if (record.ttlMs !== undefined) {
    fail(`${path}.ttlMs`, 'Unexpected field');
  }
  return {
    token: optionalString(record, 'token', path),
    session: optionalString(record, 'session', path),
    leaseId: optionalString(record, 'leaseId', path),
  };
});

function parseJsonRpcId(
  record: Record<string, unknown>,
  path: string,
): string | number | null | undefined {
  const value = record.id;
  if (value === undefined || value === null) return value as null | undefined;
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail(`${path}.id`, 'Expected a string, number, or null');
  }
  return value;
}

export const jsonRpcRequestSchema = schema<JsonRpcRequestEnvelope>((input, path) => {
  const record = expectObject(input, path);
  return {
    jsonrpc: optionalString(record, 'jsonrpc', path),
    id: parseJsonRpcId(record, path),
    method: optionalString(record, 'method', path),
    params: record.params,
  };
});
