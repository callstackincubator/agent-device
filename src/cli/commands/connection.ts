import { resolveDaemonPaths } from '../../daemon/config.ts';
import { stopMetroTunnel } from '../../metro.ts';
import { resolveRemoteConfigProfile } from '../../remote-config.ts';
import {
  fingerprint,
  hashRemoteConfigFile,
  readActiveConnectionState,
  readRemoteConnectionState,
  removeRemoteConnectionState,
  writeRemoteConnectionState,
  type RemoteConnectionState,
} from '../../remote-connection-state.ts';
import { AppError } from '../../utils/errors.ts';
import { writeCommandOutput } from './shared.ts';
import type { LeaseBackend, SessionRuntimeHints } from '../../contracts.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient, Lease } from '../../client.ts';
import type { ClientCommandHandler } from './router.ts';

export const connectCommand: ClientCommandHandler = async ({ flags, client }) => {
  if (!flags.remoteConfig) {
    throw new AppError('INVALID_ARGS', 'connect requires --remote-config <path>.');
  }
  const session = flags.session ?? 'default';
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

  const remoteConfig = resolveRemoteConfigProfile({
    configPath: flags.remoteConfig,
    cwd: process.cwd(),
    env: process.env,
  });
  const remoteConfigHash = hashRemoteConfigFile(remoteConfig.resolvedPath);
  const leaseBackend = flags.leaseBackend ?? inferLeaseBackend(flags.platform);
  const daemon = buildDaemonState(flags);
  const stateDir = resolveDaemonPaths(flags.stateDir).baseDir;
  const previous = readRemoteConnectionState({ stateDir, session });
  if (
    previous &&
    !isCompatibleConnection(previous, {
      flags,
      remoteConfigPath: remoteConfig.resolvedPath,
      remoteConfigHash,
      leaseBackend,
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

  let lease: Lease | undefined;
  let allocatedForThisCommand = false;
  let metroCleanup: NonNullable<RemoteConnectionState['metro']> | undefined;
  let statePersisted = false;
  try {
    lease =
      previous && previous.leaseId && !flags.force
        ? await heartbeatOrAllocateLease(client, previous.leaseId, { tenant, runId, leaseBackend })
        : undefined;
    if (!lease) {
      lease = await client.leases.allocate({ tenant, runId, leaseBackend });
      allocatedForThisCommand = true;
    }

    const metro = await prepareConnectedMetro(flags, client, remoteConfig.resolvedPath, session);
    metroCleanup = metro.cleanup;
    const now = new Date().toISOString();
    const state: RemoteConnectionState = {
      version: 1,
      session,
      remoteConfigPath: remoteConfig.resolvedPath,
      remoteConfigHash,
      daemon,
      tenant,
      runId,
      leaseId: lease.leaseId,
      leaseBackend,
      platform: flags.platform,
      target: flags.target,
      runtime: metro.runtime,
      metro: metroCleanup,
      connectedAt: previous && !flags.force ? previous.connectedAt : now,
      updatedAt: now,
    };
    writeRemoteConnectionState({ stateDir, state });
    statePersisted = true;
    if (
      previous &&
      flags.force &&
      (previous.metro?.projectRoot !== metroCleanup?.projectRoot ||
        previous.metro?.profileKey !== metroCleanup?.profileKey ||
        previous.metro?.consumerKey !== metroCleanup?.consumerKey)
    ) {
      await stopMetroCleanup(previous.metro);
    }
    if (
      previous &&
      flags.force &&
      (previous.tenant !== state.tenant ||
        previous.runId !== state.runId ||
        previous.leaseId !== state.leaseId ||
        !isSameDaemonState(previous.daemon, state.daemon))
    ) {
      await releasePreviousLease(client, previous);
    }

    writeCommandOutput(
      flags,
      serializeConnectionState(state),
      () =>
        `Connected remote session "${session}" tenant "${tenant}" run "${runId}" lease ${state.leaseId}`,
    );
  } catch (error) {
    if (!statePersisted) {
      await stopMetroCleanup(metroCleanup);
    }
    if (allocatedForThisCommand && lease) {
      try {
        await client.leases.release({ tenant, runId, leaseId: lease.leaseId });
      } catch {
        // Best-effort cleanup; preserve the original connection failure.
      }
    }
    throw error;
  }
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
  writeCommandOutput(flags, serializeConnectionState(state), () =>
    [
      `Connected remote session "${state.session}".`,
      `tenant=${state.tenant} runId=${state.runId} leaseId=${state.leaseId} backend=${state.leaseBackend}`,
      `remoteConfig=${state.remoteConfigPath}`,
      state.runtime ? 'metro=prepared' : 'metro=not-prepared',
    ].join('\n'),
  );
  return true;
};

async function heartbeatOrAllocateLease(
  client: AgentDeviceClient,
  leaseId: string,
  scope: { tenant: string; runId: string; leaseBackend: LeaseBackend },
): Promise<Lease | undefined> {
  try {
    return await client.leases.heartbeat({
      tenant: scope.tenant,
      runId: scope.runId,
      leaseId,
      leaseBackend: scope.leaseBackend,
    });
  } catch (error) {
    if (isInactiveLeaseError(error)) return undefined;
    throw error;
  }
}

async function prepareConnectedMetro(
  flags: CliFlags,
  client: AgentDeviceClient,
  remoteConfigPath: string,
  session: string,
): Promise<{
  runtime?: SessionRuntimeHints;
  cleanup?: NonNullable<RemoteConnectionState['metro']>;
}> {
  if (!flags.metroProjectRoot && !flags.metroPublicBaseUrl && !flags.metroProxyBaseUrl) {
    return {};
  }
  if (flags.platform !== 'ios' && flags.platform !== 'android') {
    throw new AppError(
      'INVALID_ARGS',
      'connect Metro preparation requires platform "ios" or "android".',
    );
  }
  if (!flags.metroPublicBaseUrl) {
    throw new AppError('INVALID_ARGS', 'connect Metro preparation requires metroPublicBaseUrl.');
  }
  const prepared = await client.metro.prepare({
    projectRoot: flags.metroProjectRoot,
    kind: flags.metroKind,
    publicBaseUrl: flags.metroPublicBaseUrl,
    proxyBaseUrl: flags.metroProxyBaseUrl,
    bearerToken: flags.metroBearerToken,
    launchUrl: flags.launchUrl,
    companionProfileKey: remoteConfigPath,
    companionConsumerKey: session,
    port: flags.metroPreparePort,
    listenHost: flags.metroListenHost,
    statusHost: flags.metroStatusHost,
    startupTimeoutMs: flags.metroStartupTimeoutMs,
    probeTimeoutMs: flags.metroProbeTimeoutMs,
    reuseExisting: flags.metroNoReuseExisting ? false : undefined,
    installDependenciesIfNeeded: flags.metroNoInstallDeps ? false : undefined,
    runtimeFilePath: flags.metroRuntimeFile,
  });
  return {
    runtime: flags.platform === 'ios' ? prepared.iosRuntime : prepared.androidRuntime,
    cleanup: flags.metroProxyBaseUrl
      ? {
          projectRoot: prepared.projectRoot,
          profileKey: remoteConfigPath,
          consumerKey: session,
        }
      : undefined,
  };
}

async function stopMetroCleanup(
  cleanup: RemoteConnectionState['metro'] | undefined,
): Promise<void> {
  if (!cleanup) return;
  try {
    await stopMetroTunnel(cleanup);
  } catch {
    // Connection lifecycle cleanup must stay best-effort.
  }
}

async function releasePreviousLease(
  client: AgentDeviceClient,
  previous: RemoteConnectionState,
): Promise<void> {
  try {
    await client.leases.release({
      tenant: previous.tenant,
      runId: previous.runId,
      leaseId: previous.leaseId,
      daemonBaseUrl: previous.daemon?.baseUrl,
      daemonTransport: previous.daemon?.transport,
      daemonServerMode: previous.daemon?.serverMode,
    });
  } catch {
    // Reconnect must succeed even if the old lease was already released.
  }
}

function inferLeaseBackend(platform: CliFlags['platform']): LeaseBackend {
  if (platform === 'android') return 'android-instance';
  if (platform === 'ios') return 'ios-instance';
  throw new AppError(
    'INVALID_ARGS',
    'connect requires --lease-backend when platform is not ios or android.',
  );
}

function isCompatibleConnection(
  state: RemoteConnectionState,
  options: {
    flags: CliFlags;
    remoteConfigPath: string;
    remoteConfigHash: string;
    leaseBackend: LeaseBackend;
    daemon: RemoteConnectionState['daemon'];
  },
): boolean {
  return (
    state.remoteConfigPath === options.remoteConfigPath &&
    state.remoteConfigHash === options.remoteConfigHash &&
    state.session === (options.flags.session ?? 'default') &&
    state.tenant === options.flags.tenant &&
    state.runId === options.flags.runId &&
    state.leaseBackend === options.leaseBackend &&
    state.platform === options.flags.platform &&
    state.target === options.flags.target &&
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
  return {
    baseUrl: sanitizeDaemonBaseUrl(flags.daemonBaseUrl),
    transport: flags.daemonTransport,
    serverMode: flags.daemonServerMode,
  };
}

function sanitizeDaemonBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/(auth|key|password|secret|token)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString().replace(/\/+$/, '');
}

function isInactiveLeaseError(error: unknown): boolean {
  if (!(error instanceof AppError) || error.code !== 'UNAUTHORIZED') return false;
  return (
    error.details?.reason === 'LEASE_NOT_FOUND' ||
    error.details?.reason === 'LEASE_EXPIRED' ||
    error.details?.reason === 'LEASE_REVOKED'
  );
}

function serializeConnectionState(state: RemoteConnectionState): Record<string, unknown> {
  return {
    connected: true,
    session: state.session,
    tenant: state.tenant,
    runId: state.runId,
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
    connectedAt: state.connectedAt,
    updatedAt: state.updatedAt,
  };
}
