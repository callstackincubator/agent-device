import { AppError } from './errors.ts';
import {
  getCommandSchema,
  getFlagDefinitions,
  GLOBAL_FLAG_KEYS,
  type FlagDefinition,
  type FlagKey,
} from './command-schema.ts';

const CONFIG_EXCLUDED_FLAG_KEYS = new Set<FlagKey>(['config', 'help', 'version', 'batchSteps']);

const LEGACY_ENV_VAR_NAMES: Partial<Record<FlagKey, string[]>> = {
  iosSimulatorDeviceSet: ['IOS_SIMULATOR_DEVICE_SET'],
  androidDeviceAllowlist: ['ANDROID_DEVICE_ALLOWLIST'],
};

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const flagDefinitionByKey = new Map<FlagKey, FlagDefinition>();
for (const definition of getFlagDefinitions()) {
  if (!flagDefinitionByKey.has(definition.key)) {
    flagDefinitionByKey.set(definition.key, definition);
  }
}

export function getFlagDefinitionByKey(key: FlagKey): FlagDefinition | undefined {
  return flagDefinitionByKey.get(key);
}

export function isFlagSupportedForCommand(key: FlagKey, command: string | null): boolean {
  if (GLOBAL_FLAG_KEYS.has(key)) return true;
  const schema = getCommandSchema(command);
  return Boolean(schema?.allowedFlags.includes(key));
}

export function isFlagConfigurable(key: FlagKey): boolean {
  return !CONFIG_EXCLUDED_FLAG_KEYS.has(key);
}

export function getConfigurableFlagDefinitions(command: string | null): FlagDefinition[] {
  return getFlagDefinitions().filter(
    (definition) =>
      isFlagConfigurable(definition.key) &&
      isFlagSupportedForCommand(definition.key, command),
  );
}

export function getEnvVarNamesForFlag(key: FlagKey): string[] {
  return [buildPrimaryEnvVarName(key), ...(LEGACY_ENV_VAR_NAMES[key] ?? [])];
}

export function parseFlagValueFromSource(
  definition: FlagDefinition,
  value: unknown,
  sourceLabel: string,
  rawKey: string,
): unknown {
  if (definition.type === 'boolean') {
    return parseBooleanValue(value, sourceLabel, rawKey);
  }
  if (definition.type === 'booleanOrString') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && parseBooleanLiteral(value) !== undefined) {
      return parseBooleanLiteral(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) return value;
    throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean or non-empty string.`);
  }
  if (definition.type === 'string') {
    if (typeof value === 'string' && value.trim().length > 0) return value;
    throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Expected non-empty string.`);
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
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Expected integer.`);
  }
  if (typeof definition.min === 'number' && parsed < definition.min) {
    throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Must be >= ${definition.min}.`);
  }
  if (typeof definition.max === 'number' && parsed > definition.max) {
    throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Must be <= ${definition.max}.`);
  }
  return parsed;
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
  throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean.`);
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
  throw new AppError('INVALID_ARGS', `Invalid value for "${rawKey}" in ${sourceLabel}. Expected boolean or ${String(expectedValue)}.`);
}
