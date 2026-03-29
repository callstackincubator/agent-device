import { AppError } from './errors.ts';
import { mergeDefinedFlags } from './merge-flags.ts';
import {
  buildCommandUsageText,
  buildUsageText,
  getCommandSchema,
  getFlagDefinition,
  isStrictFlagModeEnabled,
  type CliFlags,
  type FlagDefinition,
  type FlagKey,
} from './command-schema.ts';
import { isFlagSupportedForCommand } from './cli-option-schema.ts';

type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: CliFlags;
  warnings: string[];
};

type ParseArgsOptions = {
  strictFlags?: boolean;
};

type ParsedFlagRecord = {
  key: FlagKey;
  token: string;
};

type RawParsedArgs = ParsedArgs & {
  providedFlags: ParsedFlagRecord[];
};

type FinalizeArgsOptions = ParseArgsOptions & {
  defaultFlags?: Partial<CliFlags>;
};

export function parseArgs(argv: string[], options?: FinalizeArgsOptions): ParsedArgs {
  return finalizeParsedArgs(parseRawArgs(argv), options);
}

export function parseRawArgs(argv: string[]): RawParsedArgs {
  const flags: CliFlags = { json: false, help: false, version: false };
  let command: string | null = null;
  const positionals: string[] = [];
  const warnings: string[] = [];
  const providedFlags: ParsedFlagRecord[] = [];
  let parseFlags = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (parseFlags && arg === '--') {
      parseFlags = false;
      continue;
    }
    if (!parseFlags) {
      if (!command) command = normalizeCommandAlias(arg);
      else positionals.push(arg);
      continue;
    }
    const isLongFlag = arg.startsWith('--');
    const isShortFlag = arg.startsWith('-') && arg.length > 1;
    if (!isLongFlag && !isShortFlag) {
      if (!command) command = normalizeCommandAlias(arg);
      else positionals.push(arg);
      continue;
    }

    const [token, inlineValue] = isLongFlag ? splitLongFlag(arg) : [arg, undefined];
    const definition = getFlagDefinition(token);
    if (!definition) {
      if (shouldTreatUnknownDashTokenAsPositional(command, positionals, arg)) {
        if (!command) command = arg;
        else positionals.push(arg);
        continue;
      }
      throw new AppError('INVALID_ARGS', `Unknown flag: ${token}`);
    }

    const parsed = parseFlagValue(definition, token, inlineValue, argv[i + 1]);
    if (parsed.consumeNext) i += 1;
    const existingValue = (flags as Record<string, unknown>)[definition.key];
    if (definition.multiple) {
      const values = Array.isArray(existingValue)
        ? [...existingValue, parsed.value]
        : existingValue === undefined
          ? [parsed.value]
          : [existingValue, parsed.value];
      (flags as Record<string, unknown>)[definition.key] = values;
    } else {
      (flags as Record<string, unknown>)[definition.key] = parsed.value;
    }
    providedFlags.push({ key: definition.key, token });
  }

  return { command, positionals, flags, warnings, providedFlags };
}

export function finalizeParsedArgs(
  parsed: RawParsedArgs,
  options?: FinalizeArgsOptions,
): ParsedArgs {
  const strictFlags =
    options?.strictFlags ?? isStrictFlagModeEnabled(process.env.AGENT_DEVICE_STRICT_FLAGS);
  const warnings = [...parsed.warnings];
  const flags = mergeDefinedFlags(
    { json: false, help: false, version: false } as CliFlags,
    options?.defaultFlags ?? {},
  );
  mergeDefinedFlags(flags, parsed.flags);
  const commandSchema = getCommandSchema(parsed.command);
  const disallowed = parsed.providedFlags.filter(
    (entry) => !isFlagSupportedForCommand(entry.key, parsed.command),
  );
  if (disallowed.length > 0) {
    const unsupported = disallowed.map((entry) => entry.token);
    const message = formatUnsupportedFlagMessage(parsed.command, unsupported);
    if (strictFlags) {
      throw new AppError('INVALID_ARGS', message);
    }
    warnings.push(`${message} Enable AGENT_DEVICE_STRICT_FLAGS=1 to fail fast.`);
    for (const entry of disallowed) {
      delete (flags as Record<string, unknown>)[entry.key];
    }
  }
  for (const key of Object.keys(flags) as FlagKey[]) {
    if (flags[key] === undefined) continue;
    if (!isFlagSupportedForCommand(key, parsed.command)) {
      delete (flags as Record<string, unknown>)[key];
    }
  }
  assertNoConflictingBackModeFlags(parsed);
  if (commandSchema?.defaults) {
    for (const [key, value] of Object.entries(commandSchema.defaults) as Array<
      [FlagKey, unknown]
    >) {
      if ((flags as Record<string, unknown>)[key] === undefined) {
        (flags as Record<string, unknown>)[key] = value;
      }
    }
  }
  if (parsed.command === 'batch') {
    const stepSourceCount = (flags.steps ? 1 : 0) + (flags.stepsFile ? 1 : 0);
    if (stepSourceCount !== 1) {
      throw new AppError(
        'INVALID_ARGS',
        'batch requires exactly one step source: --steps or --steps-file.',
      );
    }
  }
  return { command: parsed.command, positionals: parsed.positionals, flags, warnings };
}

function assertNoConflictingBackModeFlags(parsed: RawParsedArgs): void {
  if (parsed.command !== 'back') return;
  const providedBackModeFlags = parsed.providedFlags.filter((entry) => entry.key === 'backMode');
  const distinctTokens = new Set(providedBackModeFlags.map((entry) => entry.token));
  if (distinctTokens.size <= 1) return;
  throw new AppError(
    'INVALID_ARGS',
    'back accepts only one explicit mode flag: use either --in-app or --system.',
  );
}

function splitLongFlag(flag: string): [string, string | undefined] {
  const equals = flag.indexOf('=');
  if (equals === -1) return [flag, undefined];
  return [flag.slice(0, equals), flag.slice(equals + 1)];
}

function parseFlagValue(
  definition: FlagDefinition,
  token: string,
  inlineValue: string | undefined,
  nextArg: string | undefined,
): { value: unknown; consumeNext: boolean } {
  if (definition.setValue !== undefined) {
    if (inlineValue !== undefined) {
      throw new AppError('INVALID_ARGS', `Flag ${token} does not take a value.`);
    }
    return { value: definition.setValue, consumeNext: false };
  }
  if (definition.type === 'boolean') {
    if (inlineValue !== undefined) {
      throw new AppError('INVALID_ARGS', `Flag ${token} does not take a value.`);
    }
    return { value: true, consumeNext: false };
  }
  if (definition.type === 'booleanOrString') {
    if (inlineValue !== undefined) {
      if (inlineValue.trim().length === 0) {
        throw new AppError(
          'INVALID_ARGS',
          `Flag ${token} requires a non-empty value when provided.`,
        );
      }
      return { value: inlineValue, consumeNext: false };
    }
    if (nextArg === undefined || looksLikeFlagToken(nextArg)) {
      return { value: true, consumeNext: false };
    }
    if (shouldConsumeOptionalPathValue(nextArg)) {
      return { value: nextArg, consumeNext: true };
    }
    return { value: true, consumeNext: false };
  }

  const value = inlineValue ?? nextArg;
  if (value === undefined) {
    throw new AppError('INVALID_ARGS', `Flag ${token} requires a value.`);
  }
  if (inlineValue === undefined && looksLikeFlagToken(value)) {
    throw new AppError('INVALID_ARGS', `Flag ${token} requires a value.`);
  }

  if (definition.type === 'string') {
    return { value, consumeNext: inlineValue === undefined };
  }
  if (definition.type === 'enum') {
    if (!definition.enumValues?.includes(value)) {
      throw new AppError('INVALID_ARGS', `Invalid ${labelForFlag(token)}: ${value}`);
    }
    return { value, consumeNext: inlineValue === undefined };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError('INVALID_ARGS', `Invalid ${labelForFlag(token)}: ${value}`);
  }
  if (typeof definition.min === 'number' && parsed < definition.min) {
    throw new AppError('INVALID_ARGS', `Invalid ${labelForFlag(token)}: ${value}`);
  }
  if (typeof definition.max === 'number' && parsed > definition.max) {
    throw new AppError('INVALID_ARGS', `Invalid ${labelForFlag(token)}: ${value}`);
  }
  return { value: Math.floor(parsed), consumeNext: inlineValue === undefined };
}

function labelForFlag(token: string): string {
  return token.replace(/^-+/, '');
}

function looksLikeFlagToken(value: string): boolean {
  if (!value.startsWith('-') || value === '-') return false;
  const [token] = value.startsWith('--') ? splitLongFlag(value) : [value, undefined];
  return getFlagDefinition(token) !== undefined;
}

function shouldConsumeOptionalPathValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return false;
  if (
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('/')
  ) {
    return true;
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) return true;
  return false;
}

function shouldTreatUnknownDashTokenAsPositional(
  command: string | null,
  positionals: string[],
  arg: string,
): boolean {
  if (!isNegativeNumericToken(arg)) return false;
  if (!command) return false;
  const schema = getCommandSchema(command);
  if (!schema) return true;
  if (schema.allowsExtraPositionals) return true;
  if (schema.positionalArgs.length === 0) return false;
  if (positionals.length < schema.positionalArgs.length) return true;
  return schema.positionalArgs.some((entry) => entry.includes('?'));
}

function isNegativeNumericToken(value: string): boolean {
  return /^-\d+(\.\d+)?$/.test(value);
}

function formatUnsupportedFlagMessage(command: string | null, unsupported: string[]): string {
  if (!command) {
    return unsupported.length === 1
      ? `Flag ${unsupported[0]} requires a command that supports it.`
      : `Flags ${unsupported.join(', ')} require a command that supports them.`;
  }
  return unsupported.length === 1
    ? `Flag ${unsupported[0]} is not supported for command ${command}.`
    : `Flags ${unsupported.join(', ')} are not supported for command ${command}.`;
}

export function toDaemonFlags(
  flags: CliFlags,
): Omit<CliFlags, 'json' | 'config' | 'remoteConfig' | 'help' | 'version'> {
  const {
    json: _json,
    config: _config,
    remoteConfig: _remoteConfig,
    help: _help,
    version: _version,
    sessionLock: _sessionLock,
    sessionLocked: _sessionLocked,
    sessionLockConflicts: _sessionLockConflicts,
    ...daemonFlags
  } = flags;
  return daemonFlags;
}

export function usage(): string {
  return buildUsageText();
}

export function usageForCommand(command: string): string | null {
  return buildCommandUsageText(normalizeCommandAlias(command));
}

function normalizeCommandAlias(command: string): string {
  if (command === 'long-press') return 'longpress';
  if (command === 'metrics') return 'perf';
  return command;
}
