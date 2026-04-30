import { runCmdStreaming } from '../../utils/exec.ts';
import {
  ensureReactDevtoolsCompanion,
  stopReactDevtoolsCompanion,
} from '../../client-react-devtools-companion.ts';
import { AppError } from '../../utils/errors.ts';
import type { CliFlags } from '../../utils/command-schema.ts';

const AGENT_REACT_DEVTOOLS_VERSION = '0.4.0';
export const AGENT_REACT_DEVTOOLS_PACKAGE = `agent-react-devtools@${AGENT_REACT_DEVTOOLS_VERSION}`;
const AGENT_REACT_DEVTOOLS_BIN = 'agent-react-devtools';

type ReactDevtoolsCommandOptions = {
  flags?: Pick<
    CliFlags,
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

type RemoteBridgeConfig = {
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

function isRemoteBridgeBackend(leaseBackend: CliFlags['leaseBackend']): boolean {
  return leaseBackend === 'android-instance' || leaseBackend === 'ios-instance';
}

function readRemoteBridgeField(
  missing: string[],
  field: string,
  value: string | undefined,
): string {
  if (value) return value;
  missing.push(field);
  return '';
}

function resolveRemoteBridgeConfig(
  flags: ReactDevtoolsCommandOptions['flags'],
): RemoteBridgeConfig | null {
  if (!flags?.metroProxyBaseUrl || !isRemoteBridgeBackend(flags.leaseBackend)) return null;
  const missing: string[] = [];
  const config = {
    serverBaseUrl: readRemoteBridgeField(missing, 'metroProxyBaseUrl', flags.metroProxyBaseUrl),
    bearerToken: readRemoteBridgeField(missing, 'metroBearerToken', flags.metroBearerToken),
    tenantId: readRemoteBridgeField(missing, 'tenant', flags.tenant),
    runId: readRemoteBridgeField(missing, 'runId', flags.runId),
    leaseId: readRemoteBridgeField(missing, 'leaseId', flags.leaseId),
  };
  if (missing.length > 0) {
    throw new AppError(
      'INVALID_ARGS',
      `react-devtools remote bridge requires ${missing.join(', ')}.`,
      { missing },
    );
  }
  return config;
}

async function withRemoteDevtoolsCompanion<T>(
  options: ReactDevtoolsCommandOptions,
  action: () => Promise<T>,
): Promise<T> {
  const { flags } = options;
  const bridgeConfig = resolveRemoteBridgeConfig(flags);
  if (!bridgeConfig) return action();

  const stateDir = options.stateDir ?? process.cwd();
  const session = options.session ?? flags?.session ?? 'default';
  const profileKey =
    flags?.remoteConfig ?? `${bridgeConfig.tenantId}:${bridgeConfig.runId}:${bridgeConfig.leaseId}`;
  await ensureReactDevtoolsCompanion({
    projectRoot: options.cwd ?? process.cwd(),
    stateDir,
    serverBaseUrl: bridgeConfig.serverBaseUrl,
    bearerToken: bridgeConfig.bearerToken,
    bridgeScope: {
      tenantId: bridgeConfig.tenantId,
      runId: bridgeConfig.runId,
      leaseId: bridgeConfig.leaseId,
    },
    session,
    profileKey,
    consumerKey: session,
    env: options.env ?? process.env,
  });
  try {
    return await action();
  } finally {
    await stopReactDevtoolsCompanion({
      projectRoot: options.cwd ?? process.cwd(),
      stateDir,
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
  return await withRemoteDevtoolsCompanion(options, async () => {
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
