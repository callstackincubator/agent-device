import crypto from 'node:crypto';
import { resolveDaemonPaths } from '../../daemon/config.ts';
import { resolveRemoteConfigProfile } from '../../remote-config.ts';
import {
  buildRemoteConnectionDaemonState,
  fingerprint,
  hashRemoteConfigFile,
  readActiveConnectionState,
  readRemoteConnectionState,
  removeRemoteConnectionState,
  writeRemoteConnectionState,
  type RemoteConnectionState,
} from '../../remote-connection-state.ts';
import { AppError } from '../../utils/errors.ts';
import {
  hasDeferredMetroConfig,
  releasePreviousLease,
  resolveRequestedLeaseBackend,
  stopMetroCleanup,
} from './connection-runtime.ts';
import { writeCommandOutput } from './shared.ts';
import type { LeaseBackend } from '../../contracts.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import type { ClientCommandHandler } from './router.ts';

export const connectCommand: ClientCommandHandler = async ({ flags, client }) => {
  if (!flags.remoteConfig) {
    throw new AppError('INVALID_ARGS', 'connect requires --remote-config <path>.');
  }
  const tenant = flags.tenant;
  const runId = flags.runId;
  if (!tenant) {
    throw new AppError(
      'INVALID_ARGS',
      'connect requires tenant in remote config or via --tenant <id>.',
    );
  }
  if (!runId) {
    throw new AppError(
      'INVALID_ARGS',
      'connect requires runId in remote config or via --run-id <id>.',
    );
  }
  if (!flags.daemonBaseUrl) {
    throw new AppError(
      'INVALID_ARGS',
      'connect requires daemonBaseUrl in remote config, config, env, or --daemon-base-url.',
    );
  }

  const stateDir = resolveDaemonPaths(flags.stateDir).baseDir;
  const activeState = flags.session ? null : readActiveConnectionState({ stateDir });
  const session = flags.session ?? activeState?.session ?? createRemoteSessionName(stateDir);
  const remoteConfig = resolveRemoteConfigProfile({
    configPath: flags.remoteConfig,
    cwd: process.cwd(),
    env: process.env,
  });
  const remoteConfigHash = hashRemoteConfigFile(remoteConfig.resolvedPath);
  const daemon = buildDaemonState(flags);
  const previous =
    activeState?.session === session
      ? activeState
      : readRemoteConnectionState({ stateDir, session });
  if (
    previous &&
    !isCompatibleConnection(previous, {
      flags,
      session,
      remoteConfigPath: remoteConfig.resolvedPath,
      remoteConfigHash,
      desiredLeaseBackend: resolveRequestedLeaseBackend(flags),
      daemon,
    })
  ) {
    if (!flags.force) {
      throw new AppError(
        'INVALID_ARGS',
        'A different remote connection is already active for this session. Re-run connect with --force to replace it.',
        { session, remoteConfig: previous.remoteConfigPath },
      );
    }
  }

  const now = new Date().toISOString();
  const state: RemoteConnectionState = {
    version: 1,
    session,
    remoteConfigPath: remoteConfig.resolvedPath,
    remoteConfigHash,
    daemon,
    tenant,
    runId,
    leaseId: previous && !flags.force ? previous.leaseId : undefined,
    leaseBackend:
      previous && !flags.force ? previous.leaseBackend : resolveRequestedLeaseBackend(flags),
    platform: flags.platform ?? (previous && !flags.force ? previous.platform : undefined),
    target: flags.target ?? (previous && !flags.force ? previous.target : undefined),
    runtime: previous && !flags.force ? previous.runtime : undefined,
    metro: previous && !flags.force ? previous.metro : undefined,
    connectedAt: previous && !flags.force ? previous.connectedAt : now,
    updatedAt: now,
  };
  writeRemoteConnectionState({ stateDir, state });
  if (previous && flags.force) {
    await stopMetroCleanup(previous.metro);
    await releasePreviousLease(client, previous);
  }
  const runtimePreparation = buildRuntimePreparationNotice(flags, state);

  writeCommandOutput(flags, serializeConnectionState(state, runtimePreparation), () =>
    [
      `Connected remote session "${session}" tenant "${tenant}" run "${runId}" ${
        state.leaseId ? `lease ${state.leaseId}` : 'lease pending'
      }`,
      runtimePreparation?.message,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  );
  return true;
};

export const disconnectCommand: ClientCommandHandler = async ({ flags, client }) => {
  const session = flags.session ?? 'default';
  const stateDir = resolveDaemonPaths(flags.stateDir).baseDir;
  const state =
    readRemoteConnectionState({ stateDir, session }) ??
    (flags.session ? null : readActiveConnectionState({ stateDir }));
  if (!state) {
    writeCommandOutput(
      flags,
      { connected: false, session },
      () => `No remote connection for "${session}".`,
    );
    return true;
  }
  const connectedSession = state.session;

  try {
    await client.sessions.close({ shutdown: flags.shutdown });
  } catch {
    // Disconnect is idempotent; the session may already be closed.
  }
  await stopMetroCleanup(state.metro);
  let released = false;
  if (state.leaseId) {
    try {
      const result = await client.leases.release({
        tenant: state.tenant,
        runId: state.runId,
        leaseId: state.leaseId,
      });
      released = result.released;
    } catch {
      // Bridges may release on close or be unreachable; local state still needs cleanup.
    }
  }
  removeRemoteConnectionState({ stateDir, session: connectedSession });
  writeCommandOutput(
    flags,
    { connected: false, session: connectedSession, released },
    () => `Disconnected remote session "${connectedSession}".`,
  );
  return true;
};

export const connectionCommand: ClientCommandHandler = async ({ positionals, flags }) => {
  if (positionals[0] !== 'status') {
    throw new AppError('INVALID_ARGS', 'connection accepts only: status');
  }
  const session = flags.session ?? 'default';
  const stateDir = resolveDaemonPaths(flags.stateDir).baseDir;
  const state =
    readRemoteConnectionState({ stateDir, session }) ??
    (flags.session ? null : readActiveConnectionState({ stateDir }));
  if (!state) {
    writeCommandOutput(
      flags,
      { connected: false, session },
      () => `No remote connection for "${session}".`,
    );
    return true;
  }
  const runtimePreparation = buildRuntimePreparationNoticeFromState(state);
  writeCommandOutput(flags, serializeConnectionState(state, runtimePreparation), () =>
    [
      `Connected remote session "${state.session}".`,
      `tenant=${state.tenant} runId=${state.runId} leaseId=${state.leaseId ?? 'pending'} backend=${state.leaseBackend ?? 'pending'}`,
      `remoteConfig=${state.remoteConfigPath}`,
      state.runtime ? 'metro=prepared' : 'metro=not-prepared',
      runtimePreparation?.message,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  );
  return true;
};

function createRemoteSessionName(stateDir: string): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `adc-${crypto.randomBytes(3).toString('hex')}`;
    if (!readRemoteConnectionState({ stateDir, session: candidate })) {
      return candidate;
    }
  }
  return `adc-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

function isCompatibleConnection(
  state: RemoteConnectionState,
  options: {
    flags: CliFlags;
    session: string;
    remoteConfigPath: string;
    remoteConfigHash: string;
    desiredLeaseBackend?: LeaseBackend;
    daemon: RemoteConnectionState['daemon'];
  },
): boolean {
  return (
    state.remoteConfigPath === options.remoteConfigPath &&
    state.remoteConfigHash === options.remoteConfigHash &&
    state.session === options.session &&
    state.tenant === options.flags.tenant &&
    state.runId === options.flags.runId &&
    (options.desiredLeaseBackend === undefined ||
      state.leaseBackend === options.desiredLeaseBackend) &&
    (options.flags.platform === undefined || state.platform === options.flags.platform) &&
    (options.flags.target === undefined || state.target === options.flags.target) &&
    isSameDaemonState(state.daemon, options.daemon)
  );
}

function isSameDaemonState(
  a: RemoteConnectionState['daemon'],
  b: RemoteConnectionState['daemon'],
): boolean {
  return (
    (a?.baseUrl ?? undefined) === (b?.baseUrl ?? undefined) &&
    (a?.transport ?? undefined) === (b?.transport ?? undefined) &&
    (a?.serverMode ?? undefined) === (b?.serverMode ?? undefined)
  );
}

function buildDaemonState(flags: CliFlags): RemoteConnectionState['daemon'] {
  return buildRemoteConnectionDaemonState(flags);
}

type RuntimePreparationNotice = {
  status: 'deferred';
  message: string;
  nextStep: string;
};

function buildRuntimePreparationNotice(
  flags: CliFlags,
  state: RemoteConnectionState,
): RuntimePreparationNotice | undefined {
  if (state.runtime) return undefined;
  if (!hasDeferredMetroConfig(flags) && !remoteConfigHasMetroSettings(state.remoteConfigPath)) {
    return undefined;
  }
  return buildDeferredRuntimeNotice(state.remoteConfigPath);
}

function buildRuntimePreparationNoticeFromState(
  state: RemoteConnectionState,
): RuntimePreparationNotice | undefined {
  if (state.runtime || !remoteConfigHasMetroSettings(state.remoteConfigPath)) return undefined;
  return buildDeferredRuntimeNotice(state.remoteConfigPath);
}

function buildDeferredRuntimeNotice(remoteConfigPath: string): RuntimePreparationNotice {
  const nextStep = `agent-device metro prepare --remote-config ${remoteConfigPath}`;
  return {
    status: 'deferred',
    nextStep,
    message:
      `Metro runtime is not prepared yet; it will be prepared automatically on first open/run-react-native, ` +
      `or run "${nextStep}" to inspect it before launch.`,
  };
}

function remoteConfigHasMetroSettings(remoteConfigPath: string): boolean {
  try {
    const remoteConfig = resolveRemoteConfigProfile({
      configPath: remoteConfigPath,
      cwd: process.cwd(),
      env: process.env,
    });
    const profile = remoteConfig.profile;
    return Boolean(
      profile.metroPublicBaseUrl ||
      profile.metroProxyBaseUrl ||
      profile.metroProjectRoot ||
      profile.metroKind,
    );
  } catch {
    return false;
  }
}

function serializeConnectionState(
  state: RemoteConnectionState,
  runtimePreparation?: RuntimePreparationNotice,
): Record<string, unknown> {
  return {
    connected: true,
    session: state.session,
    tenant: state.tenant,
    runId: state.runId,
    leaseAllocated: Boolean(state.leaseId),
    leaseId: state.leaseId,
    leaseBackend: state.leaseBackend,
    platform: state.platform,
    target: state.target,
    remoteConfig: state.remoteConfigPath,
    remoteConfigHash: state.remoteConfigHash,
    daemonBaseUrlFingerprint: fingerprint(state.daemon?.baseUrl),
    metro: state.metro
      ? { prepared: true, projectRoot: state.metro.projectRoot }
      : { prepared: false },
    ...(runtimePreparation ? { runtimePreparation } : {}),
    connectedAt: state.connectedAt,
    updatedAt: state.updatedAt,
  };
}
