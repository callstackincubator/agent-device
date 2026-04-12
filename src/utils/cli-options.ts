import type { CliFlags } from './command-schema.ts';
import { mergeDefinedFlags } from './merge-flags.ts';
import { finalizeParsedArgs, parseRawArgs } from './args.ts';
import { resolveConfigBackedFlagDefaults } from './cli-config.ts';
import { resolveRemoteConfigDefaults } from './remote-config.ts';

type EnvMap = Record<string, string | undefined>;

export function resolveCliOptions(
  argv: string[],
  options?: {
    cwd?: string;
    env?: EnvMap;
    strictFlags?: boolean;
  },
) {
  const rawParsed = parseRawArgs(argv);
  const env = options?.env ?? process.env;
  const cwd = options?.cwd ?? process.cwd();
  const remoteConfigDefaults = shouldApplyRemoteConfigDefaults(rawParsed.command)
    ? resolveRemoteConfigDefaults({
        remoteConfig: rawParsed.flags.remoteConfig,
        cwd,
        env,
      })
    : {};
  const defaultFlags = mergeDefinedFlags(
    resolveConfigBackedFlagDefaults({
      command: rawParsed.command,
      cwd,
      cliFlags: rawParsed.flags as CliFlags,
      env,
    }),
    remoteConfigDefaults,
  );
  const finalized = finalizeParsedArgs(rawParsed, {
    strictFlags: options?.strictFlags,
    defaultFlags,
  });
  return { ...finalized, providedFlags: rawParsed.providedFlags };
}

function shouldApplyRemoteConfigDefaults(command: string | null): boolean {
  return command === 'connect' || command === 'metro';
}
