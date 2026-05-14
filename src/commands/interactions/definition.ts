import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import {
  ALL_DEVICE_COMMAND_CAPABILITY,
  type CommandCodec,
  commandCapabilityMap,
  commandSchemaMap,
  defineCommand,
} from '../command-definition.ts';

type TypeCommandCodecOptions = {
  text: string;
  delayMs?: number;
};

export const typeCommandCodec = {
  decode: (positionals, flags) => ({
    text: positionals.join(' '),
    delayMs: flags?.delayMs,
  }),
  // `delayMs` is encoded through flags, so positionals only carry text.
  encode: (options) => [options.text],
} satisfies CommandCodec<TypeCommandCodecOptions>;

export const typeCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.type,
  schema: {
    helpDescription: 'Type text in focused field',
    positionalArgs: ['text'],
    allowsExtraPositionals: true,
    allowedFlags: ['delayMs'],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
  codec: typeCommandCodec,
});

export const INTERACTION_COMMAND_DEFINITIONS = [typeCommandDefinition] as const;

export const INTERACTION_COMMAND_SCHEMAS = commandSchemaMap(INTERACTION_COMMAND_DEFINITIONS);
export const INTERACTION_COMMAND_CAPABILITIES = commandCapabilityMap(
  INTERACTION_COMMAND_DEFINITIONS,
);
