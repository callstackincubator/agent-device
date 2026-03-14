import type { CliFlags } from './command-schema.ts';
import { finalizeParsedArgs, parseRawArgs } from './args.ts';
import { resolveConfigBackedFlagDefaults } from './cli-config.ts';

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
  const defaultFlags = resolveConfigBackedFlagDefaults({
    command: rawParsed.command,
    cwd,
    cliFlags: rawParsed.flags as CliFlags,
    env,
  });
  return finalizeParsedArgs(rawParsed, {
    strictFlags: options?.strictFlags,
    defaultFlags,
  });
}
