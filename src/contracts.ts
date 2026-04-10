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
