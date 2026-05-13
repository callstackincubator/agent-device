export type CommandDefinition<
  TName extends string,
  TFamily extends string,
  TSchema,
  TCapability,
> = {
  name: TName;
  family: TFamily;
  schema: TSchema;
  capability: TCapability;
};

export function defineCommand<TName extends string, TFamily extends string, TSchema, TCapability>(
  definition: CommandDefinition<TName, TFamily, TSchema, TCapability>,
): CommandDefinition<TName, TFamily, TSchema, TCapability> {
  return definition;
}

export function commandSchemaMap<TName extends string, TSchema>(
  definitions: readonly CommandDefinition<TName, string, TSchema, unknown>[],
): Record<TName, TSchema> {
  return Object.fromEntries(
    definitions.map((definition) => [definition.name, definition.schema]),
  ) as Record<TName, TSchema>;
}

export function commandCapabilityMap<TName extends string, TCapability>(
  definitions: readonly CommandDefinition<TName, string, unknown, TCapability>[],
): Record<TName, TCapability> {
  return Object.fromEntries(
    definitions.map((definition) => [definition.name, definition.capability]),
  ) as Record<TName, TCapability>;
}

export function commandNames<
  const TDefinitions extends readonly CommandDefinition<string, string, unknown, unknown>[],
>(definitions: TDefinitions): Array<TDefinitions[number]['name']> {
  return definitions.map((definition) => definition.name) as Array<TDefinitions[number]['name']>;
}
