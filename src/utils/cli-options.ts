import type { CliFlags } from './command-schema.ts';
import { finalizeParsedArgs, parseRawArgs } from './args.ts';
import { resolveConfigBackedFlagDefaults } from './cli-config.ts';
import { pickRemoteOpenDefaults, resolveRemoteConfigDefaults } from './remote-config.ts';

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
  const remoteConfigDefaults = resolveRemoteConfigDefaults({
    cliFlags: rawParsed.flags as CliFlags,
    cwd,
    env,
  });
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
  if (rawParsed.command === 'open' && rawParsed.flags.remoteConfig) {
    mergeMissingFlags(finalized.flags, pickRemoteOpenDefaults(defaultFlags));
  }
  return finalized;
}

function mergeDefinedFlags<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target[key as keyof T] = value as T[keyof T];
    }
  }
  return target;
}

function mergeMissingFlags<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && target[key as keyof T] === undefined) {
      target[key as keyof T] = value as T[keyof T];
    }
  }
  return target;
}
