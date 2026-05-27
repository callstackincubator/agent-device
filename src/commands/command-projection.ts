import { PUBLIC_COMMANDS } from '../command-catalog.ts';
import { buildFlags } from '../client-normalizers.ts';
import type { BatchStep } from '../client-types.ts';
import { appDaemonWriters } from './cli-grammar/apps.ts';
import { captureDaemonWriters } from './cli-grammar/capture.ts';
import { commandNameSet, request } from './cli-grammar/common.ts';
import { gestureDaemonWriters } from './cli-grammar/gesture.ts';
import { interactionDaemonWriters } from './cli-grammar/interactions.ts';
import { observabilityDaemonWriters } from './cli-grammar/observability.ts';
import { replayDaemonWriters } from './cli-grammar/replay.ts';
import { selectorDaemonWriters } from './cli-grammar/selectors.ts';
import { systemDaemonWriters } from './cli-grammar/system.ts';
import type { CommandInput, DaemonCommandRequest, DaemonWriter } from './cli-grammar/types.ts';

const daemonWriters = {
  ...appDaemonWriters,
  ...captureDaemonWriters,
  ...interactionDaemonWriters,
  ...gestureDaemonWriters,
  ...selectorDaemonWriters,
  ...observabilityDaemonWriters,
  ...replayDaemonWriters,
  ...systemDaemonWriters,
  batch: (input) =>
    request(PUBLIC_COMMANDS.batch, [], {
      ...input,
      batchSteps: input.steps,
      batchOnError: input.onError,
      batchMaxSteps: input.maxSteps,
    }),
} satisfies Record<string, DaemonWriter>;

export type DaemonCommandName = keyof typeof daemonWriters;
type NonBatchCommandName =
  | 'replay'
  | 'batch'
  | 'gesture-pan'
  | 'gesture-fling'
  | 'gesture-pinch'
  | 'gesture-rotate'
  | 'gesture-transform';
export type BatchCommandName = Exclude<DaemonCommandName, NonBatchCommandName>;

const nonBatchCommandNames = commandNameSet([
  'replay',
  'batch',
  'gesture-pan',
  'gesture-fling',
  'gesture-pinch',
  'gesture-rotate',
  'gesture-transform',
] as const satisfies readonly NonBatchCommandName[]);

export const batchCommandNames = (Object.keys(daemonWriters) as DaemonCommandName[]).filter(
  (name): name is BatchCommandName => !nonBatchCommandNames.has(name),
);

const batchNames = commandNameSet(batchCommandNames);

export function isBatchCommandName(name: string): name is BatchCommandName {
  return batchNames.has(name);
}

export function prepareBatchStep(command: DaemonCommandName, input: CommandInput): BatchStep {
  const prepared = prepareDaemonCommandRequest(command, input);
  return {
    command: prepared.command,
    positionals: prepared.positionals,
    flags: buildFlags(prepared.options),
    runtime: prepared.options.runtime,
  };
}

export function prepareDaemonCommandRequest(
  command: DaemonCommandName,
  input: CommandInput,
): DaemonCommandRequest {
  return daemonWriters[command](input);
}
