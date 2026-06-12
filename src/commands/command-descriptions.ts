import { listCommandMetadata, type CommandName } from './command-metadata.ts';

export type DescribedCommandName = CommandName;

export function listCommandDescriptionMetadata(): Array<{
  name: DescribedCommandName;
  description: string;
}> {
  return listCommandMetadata().map((metadata) => ({
    name: metadata.name,
    description: metadata.description,
  }));
}
