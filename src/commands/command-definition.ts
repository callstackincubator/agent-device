import type { CommandCapability } from '../core/capabilities.ts';
import type { CliFlags, CommandSchema } from '../utils/command-schema.ts';

export const ALL_DEVICE_COMMAND_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: { device: true },
} as const satisfies CommandCapability;

export type CommandCodec<TOptions = unknown> = {
  decode(positionals: string[], flags?: Partial<CliFlags>): TOptions;
  encode(options: TOptions): string[];
};

export type CommandDefinition<TName extends string = string, TOptions = unknown> = {
  name: TName;
  schema: CommandSchema;
  capability: CommandCapability;
  codec?: CommandCodec<TOptions>;
};

export function defineCommand<const TDefinition extends CommandDefinition<string, unknown>>(
  definition: TDefinition,
): TDefinition {
  return definition;
}

export function commandSchemaMap<TName extends string>(
  definitions: readonly CommandDefinition<TName>[],
): Record<TName, CommandSchema> {
  return Object.fromEntries(
    definitions.map((definition) => [definition.name, definition.schema]),
  ) as Record<TName, CommandSchema>;
}

export function commandCapabilityMap<TName extends string>(
  definitions: readonly CommandDefinition<TName>[],
): Record<TName, CommandCapability> {
  return Object.fromEntries(
    definitions.map((definition) => [definition.name, definition.capability]),
  ) as Record<TName, CommandCapability>;
}
