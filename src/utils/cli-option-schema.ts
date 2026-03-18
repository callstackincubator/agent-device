import { AppError } from './errors.ts';
import {
  getCliCommandNames,
  getCommandSchema,
  getFlagDefinition,
  getFlagDefinitions,
  GLOBAL_FLAG_KEYS,
  type FlagDefinition,
  type FlagKey,
} from './command-schema.ts';

export type OptionSpec = {
  key: FlagKey;
  flagDefinitions: readonly FlagDefinition[];
  config: {
    enabled: boolean;
    key: string;
  };
  env: {
    names: readonly string[];
  };
  supportsCommand(command: string | null): boolean;
};

const CONFIG_EXCLUDED_FLAG_KEYS = new Set<FlagKey>(['config', 'help', 'version', 'batchSteps']);

const LEGACY_ENV_VAR_NAMES: Partial<Record<FlagKey, string[]>> = {
  iosSimulatorDeviceSet: ['IOS_SIMULATOR_DEVICE_SET'],
  androidDeviceAllowlist: ['ANDROID_DEVICE_ALLOWLIST'],
  metroBearerToken: ['AGENT_DEVICE_PROXY_TOKEN'],
};

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const optionSpecs = buildOptionSpecs();
const optionSpecByKey = new Map(optionSpecs.map((spec) => [spec.key, spec]));

export function getOptionSpecs(): readonly OptionSpec[] {
  return optionSpecs;
}

export function getOptionSpec(key: FlagKey): OptionSpec | undefined {
  return optionSpecByKey.get(key);
}

export function getOptionSpecForToken(token: string): OptionSpec | undefined {
  const definition = getFlagDefinition(token);
  if (!definition) return undefined;
  return getOptionSpec(definition.key);
}

export function getConfigurableOptionSpecs(command: string | null): OptionSpec[] {
  return optionSpecs.filter((spec) => spec.config.enabled && spec.supportsCommand(command));
}

export function isFlagSupportedForCommand(key: FlagKey, command: string | null): boolean {
  return getOptionSpec(key)?.supportsCommand(command) ?? false;
}

export function parseOptionValueFromSource(
  spec: OptionSpec,
  value: unknown,
  sourceLabel: string,
  rawKey: string,
): unknown {
  const definition = resolveSourceValueDefinition(spec);
  if (definition.multiple) {
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues.map((entry) =>
      parseOptionValueFromSource(
        {
          ...spec,
          flagDefinitions: spec.flagDefinitions.map((flagDefinition) => ({
            ...flagDefinition,
            multiple: false,
          })),
        },
        entry,
        sourceLabel,
        rawKey,
      ),
    );
  }

  if (definition.type === 'boolean') {
    return parseBooleanValue(value, sourceLabel, rawKey);
  }
  if (definition.type === 'booleanOrString') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && parseBooleanLiteral(value) !== undefined) {
      return parseBooleanLiteral(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) return value;
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean or non-empty string.`,
    );
  }
  if (definition.type === 'string') {
    if (typeof value === 'string' && value.trim().length > 0) return value;
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected non-empty string.`,
    );
  }
  if (definition.type === 'enum') {
    if (definition.setValue !== undefined) {
      return parseEnumSetValue(definition, value, sourceLabel, rawKey);
    }
    if (typeof value !== 'string' || !definition.enumValues?.includes(value)) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid value for "${rawKey}" in ${sourceLabel}. Expected one of: ${definition.enumValues?.join(', ')}.`,
      );
    }
    return value;
  }
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Expected integer.`,
    );
  }
  if (typeof definition.min === 'number' && parsed < definition.min) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Must be >= ${definition.min}.`,
    );
  }
  if (typeof definition.max === 'number' && parsed > definition.max) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid value for "${rawKey}" in ${sourceLabel}. Must be <= ${definition.max}.`,
    );
  }
  return parsed;
}

function buildOptionSpecs(): OptionSpec[] {
  const definitionsByKey = new Map<FlagKey, FlagDefinition[]>();
  for (const definition of getFlagDefinitions()) {
    const existing = definitionsByKey.get(definition.key);
    if (existing) existing.push(definition);
    else definitionsByKey.set(definition.key, [definition]);
  }

  const supportedCommandsByKey = new Map<FlagKey, Set<string>>();
  for (const key of GLOBAL_FLAG_KEYS) {
    supportedCommandsByKey.set(key, new Set(['*']));
  }
  for (const command of getCliCommandNames()) {
    const schema = getCommandSchema(command);
    if (!schema) continue;
    for (const key of schema.allowedFlags) {
      const existing = supportedCommandsByKey.get(key);
      if (existing && existing.has('*')) continue;
      if (existing) existing.add(command);
      else supportedCommandsByKey.set(key, new Set([command]));
    }
  }

  return [...definitionsByKey.entries()]
    .map(([key, flagDefinitions]) => ({
      key,
      flagDefinitions,
      config: {
        enabled: !CONFIG_EXCLUDED_FLAG_KEYS.has(key),
        key,
      },
      env: {
        names: [buildPrimaryEnvVarName(key), ...(LEGACY_ENV_VAR_NAMES[key] ?? [])],
      },
      supportsCommand(command: string | null): boolean {
        const supported = supportedCommandsByKey.get(key);
        if (!supported) return false;
        if (supported.has('*')) return true;
        if (!command) return false;
        return supported.has(command);
      },
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function primaryFlagDefinition(spec: OptionSpec): FlagDefinition {
  const definition = spec.flagDefinitions[0];
  if (!definition) {
    throw new Error(`Missing flag definition for option ${spec.key}`);
  }
  return definition;
}

function resolveSourceValueDefinition(spec: OptionSpec): FlagDefinition {
  const explicitValueDefinition = spec.flagDefinitions.find(
    (definition) => definition.setValue === undefined,
  );
  if (explicitValueDefinition) return explicitValueDefinition;

  const baseDefinition = primaryFlagDefinition(spec);
  if (baseDefinition.type === 'enum') {
    const enumValues = spec.flagDefinitions
      .map((definition) => definition.setValue)
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    return {
      ...baseDefinition,
      setValue: undefined,
      enumValues: enumValues as readonly string[],
    };
  }
  return baseDefinition;
}

function buildPrimaryEnvVarName(key: FlagKey): string {
  return `AGENT_DEVICE_${key
    .replace(/([A-Z])/g, '_$1')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase()}`;
}

function parseBooleanValue(value: unknown, sourceLabel: string, rawKey: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const parsed = parseBooleanLiteral(value);
    if (parsed !== undefined) return parsed;
  }
  throw new AppError(
    'INVALID_ARGS',
    `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean.`,
  );
}

function parseBooleanLiteral(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function parseEnumSetValue(
  definition: FlagDefinition,
  value: unknown,
  sourceLabel: string,
  rawKey: string,
): unknown {
  const expectedValue = definition.setValue;
  if (value === expectedValue) return expectedValue;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized === '' || normalized === 'true' || normalized === '1') return expectedValue;
    if (normalized === 'false' || normalized === '0') return undefined;
  }
  if (value === true) return expectedValue;
  if (value === false) return undefined;
  throw new AppError(
    'INVALID_ARGS',
    `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean or ${String(expectedValue)}.`,
  );
}
