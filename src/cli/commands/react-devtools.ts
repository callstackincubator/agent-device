import { runCmdStreaming } from '../../utils/exec.ts';
import { ensureMetroCompanion, stopMetroCompanion } from '../../client-metro-companion.ts';
import { AppError } from '../../utils/errors.ts';
import type { CliFlags } from '../../utils/command-schema.ts';

export const AGENT_REACT_DEVTOOLS_VERSION = '0.4.0';
export const AGENT_REACT_DEVTOOLS_PACKAGE = `agent-react-devtools@${AGENT_REACT_DEVTOOLS_VERSION}`;
const AGENT_REACT_DEVTOOLS_BIN = 'agent-react-devtools';
const REACT_DEVTOOLS_LOCAL_BASE_URL = 'http://127.0.0.1:8097';
const REACT_DEVTOOLS_DEVICE_PORT = 8097;
const REACT_DEVTOOLS_REGISTER_PATH = '/api/react-devtools/companion/register';
const REACT_DEVTOOLS_UNREGISTER_PATH = '/api/react-devtools/companion/unregister';

type ReactDevtoolsCommandOptions = {
  flags?: Pick<
    CliFlags,
    | 'platform'
    | 'leaseBackend'
    | 'metroProxyBaseUrl'
    | 'metroBearerToken'
    | 'tenant'
    | 'runId'
    | 'leaseId'
    | 'remoteConfig'
    | 'session'
  >;
  stateDir?: string;
  session?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type RemoteAndroidBridgeConfig = {
  serverBaseUrl: string;
  bearerToken: string;
  tenantId: string;
  runId: string;
  leaseId: string;
};

export function buildReactDevtoolsNpmExecArgs(args: string[]): string[] {
  return [
    'exec',
    '--yes',
    '--package',
    AGENT_REACT_DEVTOOLS_PACKAGE,
    '--',
    AGENT_REACT_DEVTOOLS_BIN,
    ...args,
  ];
}

function isAndroidRemoteBridge(flags: ReactDevtoolsCommandOptions['flags']): boolean {
  if (!flags?.metroProxyBaseUrl) return false;
  return flags.platform === 'android' || flags.leaseBackend === 'android-instance';
}

function resolveRemoteAndroidBridgeConfig(
  flags: ReactDevtoolsCommandOptions['flags'],
): RemoteAndroidBridgeConfig | null {
  if (!isAndroidRemoteBridge(flags)) return null;
  const serverBaseUrl = flags?.metroProxyBaseUrl;
  const bearerToken = flags?.metroBearerToken;
  const tenantId = flags?.tenant;
  const runId = flags?.runId;
  const leaseId = flags?.leaseId;
  const missing: string[] = [];
  if (!serverBaseUrl) missing.push('metroProxyBaseUrl');
  if (!bearerToken) missing.push('metroBearerToken');
  if (!tenantId) missing.push('tenant');
  if (!runId) missing.push('runId');
  if (!leaseId) missing.push('leaseId');
  if (missing.length > 0) {
    throw new AppError(
      'INVALID_ARGS',
      `react-devtools remote Android bridge requires ${missing.join(', ')}.`,
      { missing },
    );
  }
  if (!serverBaseUrl || !bearerToken || !tenantId || !runId || !leaseId) {
    throw new AppError('INVALID_ARGS', 'react-devtools remote Android bridge is incomplete.');
  }
  return {
    serverBaseUrl,
    bearerToken,
    tenantId,
    runId,
    leaseId,
  };
}

async function withRemoteAndroidDevtoolsCompanion<T>(
  options: ReactDevtoolsCommandOptions,
  action: () => Promise<T>,
): Promise<T> {
  const { flags } = options;
  const bridgeConfig = resolveRemoteAndroidBridgeConfig(flags);
  if (!bridgeConfig) return action();

  const stateDir = options.stateDir ?? process.cwd();
  const session = options.session ?? flags?.session ?? 'default';
  const profileKey =
    flags?.remoteConfig ?? `${bridgeConfig.tenantId}:${bridgeConfig.runId}:${bridgeConfig.leaseId}`;
  await ensureMetroCompanion({
    projectRoot: options.cwd ?? process.cwd(),
    stateDir,
    kind: 'react-devtools',
    serverBaseUrl: bridgeConfig.serverBaseUrl,
    bearerToken: bridgeConfig.bearerToken,
    localBaseUrl: REACT_DEVTOOLS_LOCAL_BASE_URL,
    bridgeScope: {
      tenantId: bridgeConfig.tenantId,
      runId: bridgeConfig.runId,
      leaseId: bridgeConfig.leaseId,
    },
    registerPath: REACT_DEVTOOLS_REGISTER_PATH,
    unregisterPath: REACT_DEVTOOLS_UNREGISTER_PATH,
    devicePort: REACT_DEVTOOLS_DEVICE_PORT,
    session,
    profileKey,
    consumerKey: session,
    env: options.env ?? process.env,
  });
  try {
    return await action();
  } finally {
    await stopMetroCompanion({
      projectRoot: options.cwd ?? process.cwd(),
      stateDir,
      kind: 'react-devtools',
      profileKey,
      consumerKey: session,
    });
  }
}

export async function runReactDevtoolsCommand(
  args: string[],
  options: ReactDevtoolsCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  return await withRemoteAndroidDevtoolsCompanion(options, async () => {
    const result = await runCmdStreaming('npm', buildReactDevtoolsNpmExecArgs(args), {
      cwd,
      env,
      allowFailure: true,
      onStdoutChunk: (chunk) => {
        process.stdout.write(chunk);
      },
      onStderrChunk: (chunk) => {
        process.stderr.write(chunk);
      },
    });
    return result.exitCode;
  });
}
