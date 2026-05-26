import type { TypeTextOptions } from '../client-types.ts';
import type { CliFlags } from '../utils/command-schema.ts';

export const typeCommandCodec = {
  decode: (positionals: string[], flags?: Partial<CliFlags>): TypeTextOptions => ({
    text: positionals.join(' '),
    delayMs: flags?.delayMs,
  }),
};
