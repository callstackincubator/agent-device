import { PUBLIC_COMMANDS } from './command-catalog.ts';

export const CLIENT_COMMANDS = PUBLIC_COMMANDS;
export type ClientCommandName = (typeof CLIENT_COMMANDS)[keyof typeof CLIENT_COMMANDS];
