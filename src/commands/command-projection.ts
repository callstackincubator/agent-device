import { createBatchDaemonWriter, type BatchCommandName } from './batch/index.ts';
import { captureDaemonWriters } from './capture/index.ts';
import type { CommandInput, DaemonCommandRequest, DaemonWriter } from './cli-grammar/types.ts';
import {
  gestureDaemonWriters,
  interactionDaemonWriters,
  selectorDaemonWriters,
} from './interaction/index.ts';
import { appDaemonWriters } from './management/index.ts';
import { observabilityDaemonWriters } from './observability/index.ts';
import { perfDaemonWriters } from './perf/index.ts';
import { reactNativeDaemonWriters } from './react-native/index.ts';
import { recordingDaemonWriters } from './recording/index.ts';
import { replayDaemonWriters } from './replay/index.ts';
import { systemDaemonWriters } from './system/index.ts';

const daemonWriters = {
  ...appDaemonWriters,
  ...captureDaemonWriters,
  ...interactionDaemonWriters,
  ...gestureDaemonWriters,
  ...selectorDaemonWriters,
  ...observabilityDaemonWriters,
  ...perfDaemonWriters,
  ...reactNativeDaemonWriters,
  ...recordingDaemonWriters,
  ...replayDaemonWriters,
  ...systemDaemonWriters,
  batch: createBatchDaemonWriter(prepareBatchDaemonCommandRequest),
} satisfies Record<string, DaemonWriter>;

export type DaemonCommandName = keyof typeof daemonWriters;

export type { BatchCommandName };

function prepareBatchDaemonCommandRequest(
  command: string,
  input: CommandInput,
): DaemonCommandRequest {
  const writer = (daemonWriters as Readonly<Record<string, DaemonWriter>>)[command];
  if (!writer) {
    throw new Error(`Missing daemon writer for batch command: ${command}`);
  }
  return writer(input);
}

export function prepareDaemonCommandRequest(
  command: DaemonCommandName,
  input: CommandInput,
): DaemonCommandRequest {
  return daemonWriters[command](input);
}
