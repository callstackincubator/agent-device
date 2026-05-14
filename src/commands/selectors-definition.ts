import { PUBLIC_COMMANDS } from '../command-catalog.ts';
import type { FlagKey } from '../utils/command-schema.ts';
import {
  ALL_DEVICE_COMMAND_CAPABILITY,
  commandCapabilityMap,
  commandSchemaMap,
  defineCommand,
} from './command-definition.ts';

export const SELECTOR_SNAPSHOT_FLAGS = [
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
] as const satisfies readonly FlagKey[];

const waitCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.wait,
  schema: {
    usageOverride: 'wait <ms>|text <text>|@ref|<selector> [timeoutMs]',
    helpDescription: 'Wait for duration, text, ref, or selector to appear',
    summary: 'Wait for time, text, ref, or selector',
    positionalArgs: ['durationOrSelector', 'timeoutMs?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

const getCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.get,
  schema: {
    usageOverride: 'get text|attrs <@ref|selector>',
    helpDescription:
      'Return exposed element text/attributes by ref or selector; use snapshot -s @ref for truncated previews',
    summary: 'Get exposed text or attrs by ref or selector',
    positionalArgs: ['subcommand', 'target'],
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

const findCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.find,
  schema: {
    usageOverride: 'find <locator|text> <action> [value] [--first|--last]',
    helpDescription: 'Find by text/label/value/role/id and run action',
    summary: 'Find an element and act',
    positionalArgs: ['query', 'action', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: ['snapshotDepth', 'snapshotRaw', 'findFirst', 'findLast'],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

const isCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.is,
  schema: {
    helpDescription: 'Assert UI state (visible|hidden|exists|editable|selected|text)',
    summary: 'Assert UI state',
    positionalArgs: ['predicate', 'selector', 'value?'],
    allowsExtraPositionals: true,
    allowedFlags: [...SELECTOR_SNAPSHOT_FLAGS],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

export const SELECTOR_COMMAND_DEFINITIONS = [
  waitCommandDefinition,
  getCommandDefinition,
  findCommandDefinition,
  isCommandDefinition,
] as const;

export const SELECTOR_COMMAND_SCHEMAS = commandSchemaMap(SELECTOR_COMMAND_DEFINITIONS);
export const SELECTOR_COMMAND_CAPABILITIES = commandCapabilityMap(SELECTOR_COMMAND_DEFINITIONS);
