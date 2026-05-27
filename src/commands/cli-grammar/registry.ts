import type { CliFlags } from '../../utils/command-schema.ts';
import { appCliReaders } from './apps.ts';
import { captureCliReaders } from './capture.ts';
import { commonInputFromFlags } from './common.ts';
import { gestureCliReaders } from './gesture.ts';
import { interactionCliReaders } from './interactions.ts';
import { metroCliReaders } from './metro.ts';
import { observabilityCliReaders } from './observability.ts';
import { replayCliReaders } from './replay.ts';
import { selectorCliReaders } from './selectors.ts';
import { systemCliReaders } from './system.ts';
import type { CliReader } from './types.ts';
import type { CommandName } from '../command-surface.ts';

const cliReaders = {
  ...appCliReaders,
  ...captureCliReaders,
  ...interactionCliReaders,
  ...gestureCliReaders,
  ...selectorCliReaders,
  ...observabilityCliReaders,
  ...replayCliReaders,
  ...systemCliReaders,
  ...metroCliReaders,
  batch: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    steps: flags.batchSteps ?? [],
    onError: flags.batchOnError,
    maxSteps: flags.batchMaxSteps,
    out: flags.out,
  }),
} satisfies Record<CommandName, CliReader>;

export function readInputFromCli(
  command: CommandName,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  return cliReaders[command](positionals, flags);
}
