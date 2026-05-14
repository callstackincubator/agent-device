import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import { commandCapabilityMap, commandSchemaMap, defineCommand } from '../command-definition.ts';

export const typeCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.type,
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
});

export const INTERACTION_COMMAND_DEFINITIONS = [typeCommandDefinition] as const;

export const INTERACTION_COMMAND_SCHEMAS = commandSchemaMap(INTERACTION_COMMAND_DEFINITIONS);
export const INTERACTION_COMMAND_CAPABILITIES = commandCapabilityMap(
  INTERACTION_COMMAND_DEFINITIONS,
);
