import { defineSemanticCommand } from './semantic-contract.ts';
import {
  commandInputSchema,
  commandResultSchema,
  stringArraySchema,
  stringSchema,
} from './semantic-common.ts';

const LOCAL_ONLY_COMMANDS = [
  'auth',
  'connect',
  'connection',
  'disconnect',
  'react-devtools',
] as const;

export const semanticLocalCommands = LOCAL_ONLY_COMMANDS.map((name) =>
  defineSemanticCommand({
    name,
    description: `${name} is a local CLI workflow and is exposed as an explicit MCP boundary.`,
    inputSchema: commandInputSchema({
      action: stringSchema('Local subcommand/action.'),
      args: stringArraySchema('Additional local CLI arguments.'),
    }),
    outputSchema: commandResultSchema(),
    readInput: (input) => input,
    run: async () => {
      throw new Error(
        `${name} is local-only and is not available as an MCP automation command. Use the CLI for this workflow.`,
      );
    },
  }),
);
