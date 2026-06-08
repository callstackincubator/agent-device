import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import { commonInputFromFlags, request, requiredDaemonString, requiredString } from './common.ts';
import type { CliReader, CommandInput, DaemonWriter } from './types.ts';

export const replayCliReaders = {
  replay: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    path: requiredString(positionals[0], 'replay requires path'),
    update: flags.replayUpdate,
    backend: flags.replayMaestro ? 'maestro' : undefined,
    env: flags.replayEnv,
  }),
  test: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    paths: positionals,
    update: flags.replayUpdate,
    backend: flags.replayMaestro ? 'maestro' : undefined,
    env: flags.replayEnv,
    failFast: flags.failFast,
    timeoutMs: flags.timeoutMs,
    retries: flags.retries,
    recordVideo: flags.recordVideo,
    artifactsDir: flags.artifactsDir,
    reportJunit: flags.reportJunit,
    shardAll: flags.shardAll,
    shardSplit: flags.shardSplit,
  }),
} satisfies Record<string, CliReader>;

export const replayDaemonWriters = {
  replay: (input) =>
    request(PUBLIC_COMMANDS.replay, [requiredDaemonString(input.path, 'replay requires path')], {
      ...input,
      replayUpdate: input.update,
      replayBackend: readReplayBackend(input),
      replayEnv: input.env,
      replayShellEnv: collectReplayClientShellEnv(process.env),
    }),
  test: (input) =>
    request(PUBLIC_COMMANDS.test, input.paths ?? [], {
      ...input,
      replayUpdate: input.update,
      replayBackend: readReplayBackend(input),
      replayEnv: input.env,
      replayShellEnv: collectReplayClientShellEnv(process.env),
    }),
} satisfies Record<string, DaemonWriter>;

const REPLAY_SHELL_ENV_PREFIX = 'AD_VAR_';

function readReplayBackend(input: CommandInput): string | undefined {
  return input.backend ?? (input.maestro === true ? 'maestro' : undefined);
}

function collectReplayClientShellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && key.startsWith(REPLAY_SHELL_ENV_PREFIX)) result[key] = value;
  }
  return result;
}
