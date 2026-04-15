import {
  hasBackendEscapeHatch,
  hasBackendCapability,
  type AgentDeviceBackend,
  type BackendCapabilityName,
} from './backend.ts';
import type { ArtifactAdapter } from './io.ts';
import type { SnapshotState } from './utils/snapshot.ts';
import { AppError } from './utils/errors.ts';
import { bindCommands, type BoundAgentDeviceCommands } from './commands/index.ts';

export type CommandPolicy = {
  allowLocalInputPaths: boolean;
  allowLocalOutputPaths: boolean;
  maxImagePixels: number;
  allowNamedBackendCapabilities: readonly BackendCapabilityName[];
};

export type CommandSessionRecord = {
  name: string;
  appId?: string;
  appBundleId?: string;
  appName?: string;
  backendSessionId?: string;
  snapshot?: SnapshotState;
  metadata?: Record<string, unknown>;
};

export type CommandSessionStore = {
  get(name: string): CommandSessionRecord | undefined | Promise<CommandSessionRecord | undefined>;
  set(record: CommandSessionRecord): void | Promise<void>;
  delete?(name: string): void | Promise<void>;
  list?(): readonly CommandSessionRecord[] | Promise<readonly CommandSessionRecord[]>;
};

export type CommandContext = {
  session?: string;
  requestId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type DiagnosticsSink = {
  emit(event: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }): void;
};

export type CommandClock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type AgentDeviceRuntime = {
  backend: AgentDeviceBackend;
  artifacts: ArtifactAdapter;
  sessions: CommandSessionStore;
  policy: CommandPolicy;
  diagnostics?: DiagnosticsSink;
  clock?: CommandClock;
  signal?: AbortSignal;
};

export type AgentDeviceRuntimeConfig = {
  backend: AgentDeviceBackend;
  artifacts: ArtifactAdapter;
  sessions?: CommandSessionStore;
  policy?: CommandPolicy;
  diagnostics?: DiagnosticsSink;
  clock?: CommandClock;
  signal?: AbortSignal;
};

export type AgentDevice = AgentDeviceRuntime & BoundAgentDeviceCommands;

export function createAgentDevice(config: AgentDeviceRuntimeConfig): AgentDevice {
  const runtime: AgentDeviceRuntime = {
    backend: config.backend,
    artifacts: config.artifacts,
    sessions: config.sessions ?? createMemorySessionStore(),
    policy: config.policy ?? restrictedCommandPolicy(),
    diagnostics: config.diagnostics,
    clock: config.clock,
    signal: config.signal,
  };

  return {
    ...runtime,
    ...bindCommands(runtime),
  };
}

export function createMemorySessionStore(
  records: readonly CommandSessionRecord[] = [],
): CommandSessionStore {
  const sessions = new Map(
    records.map((record) => [record.name, cloneDefinedSessionRecord(record)]),
  );
  return {
    get: (name) => cloneSessionRecord(sessions.get(name)),
    set: (record) => {
      sessions.set(record.name, cloneSessionRecord(record));
    },
    delete: (name) => {
      sessions.delete(name);
    },
    list: () => Array.from(sessions.values(), cloneDefinedSessionRecord),
  };
}

function cloneDefinedSessionRecord(record: CommandSessionRecord): CommandSessionRecord {
  return cloneSessionRecord(record);
}

function cloneSessionRecord(record: CommandSessionRecord): CommandSessionRecord;
function cloneSessionRecord(record: undefined): undefined;
function cloneSessionRecord(
  record: CommandSessionRecord | undefined,
): CommandSessionRecord | undefined;
function cloneSessionRecord(
  record: CommandSessionRecord | undefined,
): CommandSessionRecord | undefined {
  if (!record) return undefined;
  return {
    ...record,
    ...(record.snapshot ? { snapshot: structuredClone(record.snapshot) } : {}),
    ...(record.metadata ? { metadata: cloneMetadata(record.metadata) } : {}),
  };
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(metadata) as Record<string, unknown>;
  } catch {
    return { ...metadata };
  }
}

export function localCommandPolicy(overrides: Partial<CommandPolicy> = {}): CommandPolicy {
  return {
    allowLocalInputPaths: true,
    allowLocalOutputPaths: true,
    maxImagePixels: 20_000_000,
    allowNamedBackendCapabilities: [],
    ...overrides,
  };
}

export function restrictedCommandPolicy(overrides: Partial<CommandPolicy> = {}): CommandPolicy {
  return {
    allowLocalInputPaths: false,
    allowLocalOutputPaths: false,
    maxImagePixels: 20_000_000,
    allowNamedBackendCapabilities: [],
    ...overrides,
  };
}

export function assertBackendCapabilityAllowed(
  runtime: Pick<AgentDeviceRuntime, 'backend' | 'policy'>,
  capability: BackendCapabilityName,
): void {
  if (!hasBackendCapability(runtime.backend, capability)) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Backend capability ${capability} is not supported by this backend`,
      { capability },
    );
  }
  if (!runtime.policy.allowNamedBackendCapabilities.includes(capability)) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Backend capability ${capability} is not allowed by command policy`,
      { capability },
    );
  }
  if (!hasBackendEscapeHatch(runtime.backend, capability)) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Backend capability ${capability} does not implement its escape hatch method`,
      { capability },
    );
  }
}
