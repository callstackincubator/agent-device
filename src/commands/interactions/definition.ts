import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import type { CommandCapability } from '../../core/capabilities.ts';
import type { CommandSchema } from '../../utils/command-schema.ts';
import {
  commandCapabilityMap,
  commandNames,
  commandSchemaMap,
  defineCommand,
} from '../command-definition.ts';

export const INTERACTION_COMMAND_FAMILY = 'interactions';

export const typeCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.type,
  family: INTERACTION_COMMAND_FAMILY,
  schema: {
    helpDescription: 'Type text in focused field',
    positionalArgs: ['text'],
    allowsExtraPositionals: true,
    allowedFlags: ['delayMs'],
  },
  capability: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: { device: true },
  },
} satisfies {
  name: typeof PUBLIC_COMMANDS.type;
  family: typeof INTERACTION_COMMAND_FAMILY;
  schema: CommandSchema;
  capability: CommandCapability;
});

export const INTERACTION_COMMAND_DEFINITIONS = [typeCommandDefinition] as const;

export const INTERACTION_COMMAND_SCHEMAS = commandSchemaMap(INTERACTION_COMMAND_DEFINITIONS);
export const INTERACTION_COMMAND_CAPABILITIES = commandCapabilityMap(
  INTERACTION_COMMAND_DEFINITIONS,
);
export const INTERACTION_COMMAND_NAMES = commandNames(INTERACTION_COMMAND_DEFINITIONS);
