import type {
  AgentDeviceRequestOverrides,
  AgentDeviceSelectionOptions,
  InteractionTarget,
} from '../client-types.ts';
import type { DeviceTarget, PlatformSelector } from '../utils/device.ts';
import type { JsonSchema } from './semantic-contract.ts';

const PLATFORM_VALUES = ['ios', 'android', 'macos', 'linux', 'apple'] as const;
const DEVICE_TARGET_VALUES = ['mobile', 'tv', 'desktop'] as const;
const INTERACTION_TARGET_KINDS = ['ref', 'selector', 'point'] as const;

export type CommonCommandInput = Pick<
  AgentDeviceRequestOverrides,
  'session' | 'daemonBaseUrl' | 'daemonAuthToken' | 'tenant' | 'runId' | 'leaseId' | 'cwd' | 'debug'
> & {
  platform?: PlatformSelector;
  deviceTarget?: DeviceTarget;
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
};

export type SemanticInteractionTarget =
  | { kind: 'ref'; ref: string; label?: string }
  | { kind: 'selector'; selector: string }
  | { kind: 'point'; x: number; y: number };

export type RepeatedInput = {
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};

export type SelectorSnapshotInput = {
  depth?: number;
  scope?: string;
  raw?: boolean;
};

export type PointInput = { x: number; y: number };

export function commandInputSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties: {
      ...commonProperties(),
      ...properties,
    },
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export function interactionInputSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[] = ['target'],
): JsonSchema {
  return commandInputSchema(
    {
      target: interactionTargetSchema(),
      depth: snapshotDepthSchema(),
      scope: { type: 'string', description: 'Snapshot scope selector used before resolution.' },
      raw: { type: 'boolean', description: 'Use raw snapshot data during selector resolution.' },
      ...properties,
    },
    required,
  );
}

export function repeatedProperties(): Record<string, JsonSchema> {
  return {
    count: { type: 'integer', minimum: 1, description: 'Number of press/click repetitions.' },
    intervalMs: {
      type: 'integer',
      minimum: 0,
      description: 'Delay between repeated press/click actions.',
    },
    holdMs: { type: 'integer', minimum: 0, description: 'Hold duration for each action.' },
    jitterPx: { type: 'integer', minimum: 0, description: 'Randomization radius in pixels.' },
    doubleTap: { type: 'boolean', description: 'Request a double-tap action.' },
  };
}

export function pointSchema(description: string): JsonSchema {
  return {
    type: 'object',
    description,
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
    },
    required: ['x', 'y'],
    additionalProperties: false,
  };
}

function snapshotDepthSchema(): JsonSchema {
  return { type: 'integer', minimum: 0, description: 'Snapshot traversal depth.' };
}

export function commandResultSchema(): JsonSchema {
  return { type: 'object', additionalProperties: true };
}

export function enumSchema(values: readonly string[], description?: string): JsonSchema {
  return { type: 'string', enum: values, ...(description ? { description } : {}) };
}

export function stringSchema(description?: string): JsonSchema {
  return { type: 'string', ...(description ? { description } : {}) };
}

export function numberSchema(description?: string): JsonSchema {
  return { type: 'number', ...(description ? { description } : {}) };
}

export function integerSchema(description?: string): JsonSchema {
  return { type: 'integer', ...(description ? { description } : {}) };
}

export function booleanSchema(description?: string): JsonSchema {
  return { type: 'boolean', ...(description ? { description } : {}) };
}

export function stringArraySchema(description?: string): JsonSchema {
  return {
    type: 'array',
    items: { type: 'string' },
    ...(description ? { description } : {}),
  };
}

export function looseObjectSchema(description?: string): JsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    ...(description ? { description } : {}),
  };
}

export function readInputRecord(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Expected object arguments.');
  }
  return input as Record<string, unknown>;
}

export function readClientOptions<TOptions>(input: unknown): TOptions {
  const record = readInputRecord(input);
  const commandOptions = commandOptionsFromInputRecord(record);
  return compactRecord({
    ...commandOptions,
    ...commonToClientOptions(readCommonInput(record)),
  }) as TOptions;
}

export function readCommonInput(record: Record<string, unknown>): CommonCommandInput {
  return {
    session: optionalString(record, 'session'),
    platform: optionalEnum(record, 'platform', PLATFORM_VALUES),
    deviceTarget: optionalEnum(record, 'deviceTarget', DEVICE_TARGET_VALUES),
    device: optionalString(record, 'device'),
    udid: optionalString(record, 'udid'),
    serial: optionalString(record, 'serial'),
    iosSimulatorDeviceSet: optionalString(record, 'iosSimulatorDeviceSet'),
    androidDeviceAllowlist: optionalString(record, 'androidDeviceAllowlist'),
    daemonBaseUrl: optionalString(record, 'daemonBaseUrl'),
    daemonAuthToken: optionalString(record, 'daemonAuthToken'),
    tenant: optionalString(record, 'tenant'),
    runId: optionalString(record, 'runId'),
    leaseId: optionalString(record, 'leaseId'),
    cwd: optionalString(record, 'cwd'),
    debug: optionalBoolean(record, 'debug'),
  };
}

export function readRepeatedInput(record: Record<string, unknown>): RepeatedInput {
  return {
    count: optionalInteger(record, 'count', { min: 1 }),
    intervalMs: optionalInteger(record, 'intervalMs', { min: 0 }),
    holdMs: optionalInteger(record, 'holdMs', { min: 0 }),
    jitterPx: optionalInteger(record, 'jitterPx', { min: 0 }),
    doubleTap: optionalBoolean(record, 'doubleTap'),
  };
}

export function readSelectorSnapshotInput(record: Record<string, unknown>): SelectorSnapshotInput {
  return {
    depth: optionalInteger(record, 'depth', { min: 0 }),
    scope: optionalString(record, 'scope'),
    raw: optionalBoolean(record, 'raw'),
  };
}

export function readInteractionTarget(
  record: Record<string, unknown>,
  key: string,
): SemanticInteractionTarget {
  const target = readRecordField(record, key);
  const kind = requiredEnum(target, 'kind', INTERACTION_TARGET_KINDS);
  switch (kind) {
    case 'ref':
      return {
        kind,
        ref: requiredString(target, 'ref'),
        label: optionalString(target, 'label'),
      };
    case 'selector':
      return { kind, selector: requiredString(target, 'selector') };
    case 'point':
      return {
        kind,
        x: requiredNumber(target, 'x'),
        y: requiredNumber(target, 'y'),
      };
  }
}

export function readPoint(record: Record<string, unknown>, key: string): PointInput {
  const point = readRecordField(record, key);
  return { x: requiredNumber(point, 'x'), y: requiredNumber(point, 'y') };
}

export function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return value;
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return value;
}

export function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected ${key} to be a finite number.`);
  }
  return value;
}

export function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new Error(`Expected ${key} to be an integer.`);
  }
  const numberValue = value as number;
  if (options.min !== undefined && numberValue < options.min) {
    throw new Error(`Expected ${key} to be at least ${options.min}.`);
  }
  if (options.max !== undefined && numberValue > options.max) {
    throw new Error(`Expected ${key} to be at most ${options.max}.`);
  }
  return numberValue;
}

export function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`Expected ${key} to be a boolean.`);
  }
  return value;
}

export function requiredEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  values: T,
): T[number] {
  const value = record[key];
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`Expected ${key} to be one of: ${values.join(', ')}.`);
  }
  return value;
}

export function optionalEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  values: T,
): T[number] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`Expected ${key} to be one of: ${values.join(', ')}.`);
  }
  return value;
}

export function commonToClientOptions(
  input: CommonCommandInput,
): AgentDeviceRequestOverrides & AgentDeviceSelectionOptions {
  return {
    session: input.session,
    platform: input.platform,
    target: input.deviceTarget,
    device: input.device,
    udid: input.udid,
    serial: input.serial,
    iosSimulatorDeviceSet: input.iosSimulatorDeviceSet,
    androidDeviceAllowlist: input.androidDeviceAllowlist,
    daemonBaseUrl: input.daemonBaseUrl,
    daemonAuthToken: input.daemonAuthToken,
    tenant: input.tenant,
    runId: input.runId,
    leaseId: input.leaseId,
    cwd: input.cwd,
    debug: input.debug,
  };
}

export function toClientInteractionTarget(target: SemanticInteractionTarget): InteractionTarget {
  switch (target.kind) {
    case 'ref':
      return { ref: target.ref, label: target.label };
    case 'selector':
      return { selector: target.selector };
    case 'point':
      return { x: target.x, y: target.y };
  }
}

export function toRepeatedOptions(input: RepeatedInput): RepeatedInput {
  return {
    count: input.count,
    intervalMs: input.intervalMs,
    holdMs: input.holdMs,
    jitterPx: input.jitterPx,
    doubleTap: input.doubleTap,
  };
}

export function toSelectorSnapshotOptions(input: SelectorSnapshotInput): SelectorSnapshotInput {
  return {
    depth: input.depth,
    scope: input.scope,
    raw: input.raw,
  };
}

export function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} has unknown field(s): ${unknownKeys.join(', ')}.`);
  }
}

export function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

const COMMON_INPUT_KEYS = new Set([
  'session',
  'platform',
  'deviceTarget',
  'device',
  'udid',
  'serial',
  'iosSimulatorDeviceSet',
  'androidDeviceAllowlist',
  'stateDir',
  'daemonBaseUrl',
  'daemonAuthToken',
  'tenant',
  'runId',
  'leaseId',
  'cwd',
  'debug',
]);

function commandOptionsFromInputRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !COMMON_INPUT_KEYS.has(key)));
}

function commonProperties(): Record<string, JsonSchema> {
  return {
    session: { type: 'string', description: 'Agent-device session name.' },
    platform: {
      type: 'string',
      enum: PLATFORM_VALUES,
      description: 'Platform selector used to resolve a device.',
    },
    deviceTarget: {
      type: 'string',
      enum: DEVICE_TARGET_VALUES,
      description: 'Device target form. Maps to the CLI --target flag.',
    },
    device: { type: 'string', description: 'Device name selector.' },
    udid: { type: 'string', description: 'iOS device UDID selector.' },
    serial: { type: 'string', description: 'Android serial selector.' },
    iosSimulatorDeviceSet: {
      type: 'string',
      description: 'iOS simulator device-set path used for device resolution.',
    },
    androidDeviceAllowlist: {
      type: 'string',
      description: 'Android serial allowlist used for device resolution.',
    },
    stateDir: { type: 'string', description: 'Agent-device state directory.' },
    daemonBaseUrl: { type: 'string', description: 'Remote daemon base URL.' },
    daemonAuthToken: { type: 'string', description: 'Remote daemon auth token.' },
    tenant: { type: 'string', description: 'Remote tenant identifier.' },
    runId: { type: 'string', description: 'Lease run identifier.' },
    leaseId: { type: 'string', description: 'Existing lease identifier.' },
    cwd: { type: 'string', description: 'Working directory for command execution.' },
    debug: { type: 'boolean', description: 'Enable debug diagnostics.' },
  };
}

function interactionTargetSchema(): JsonSchema {
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'ref' },
          ref: { type: 'string', description: 'Snapshot element ref such as @e12.' },
          label: { type: 'string', description: 'Optional human label for the ref.' },
        },
        required: ['kind', 'ref'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'selector' },
          selector: { type: 'string', description: 'Agent-device selector expression.' },
        },
        required: ['kind', 'selector'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'point' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['kind', 'x', 'y'],
        additionalProperties: false,
      },
    ],
    description: 'UI target. This is separate from deviceTarget, which selects the device form.',
  };
}

function readRecordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an object.`);
  }
  return value as Record<string, unknown>;
}
