import type { CliFlags } from '../../utils/cli-flags.ts';
import { batchCliReaders } from '../batch/index.ts';
import { captureCliReaders } from '../capture/index.ts';
import type { CliReader } from './types.ts';
import type { CommandName } from '../command-metadata.ts';
import {
  gestureCliReaders,
  interactionCliReaders,
  selectorCliReaders as interactionSelectorCliReaders,
} from '../interaction/index.ts';
import { appCliReaders } from '../management/index.ts';
import { metroCliReaders } from '../metro/index.ts';
import { observabilityCliReaders } from '../observability/index.ts';
import { reactNativeCliReaders } from '../react-native/index.ts';
import { recordingCliReaders } from '../recording/index.ts';
import { replayCliReaders } from '../replay/index.ts';
import { systemCliReaders } from '../system/index.ts';

const cliReaders = {
  ...appCliReaders,
  ...captureCliReaders,
  ...interactionCliReaders,
  ...gestureCliReaders,
  ...interactionSelectorCliReaders,
  ...observabilityCliReaders,
  ...reactNativeCliReaders,
  ...recordingCliReaders,
  ...replayCliReaders,
  ...systemCliReaders,
  ...metroCliReaders,
  ...batchCliReaders,
} satisfies Record<CommandName, CliReader>;

export function readInputFromCli(
  command: CommandName,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  return cliReaders[command](positionals, flags);
}
