import type { AgentDeviceRuntime } from '../../../runtime-contract.ts';
import type { BoundRuntimeCommand, RuntimeCommand } from '../../runtime-types.ts';
import {
  recordCommand,
  traceCommand,
  type RecordingRecordCommandOptions,
  type RecordingRecordCommandResult,
  type RecordingTraceCommandOptions,
  type RecordingTraceCommandResult,
} from './recording.ts';

export type RecordingCommands = {
  record: RuntimeCommand<RecordingRecordCommandOptions, RecordingRecordCommandResult>;
  trace: RuntimeCommand<RecordingTraceCommandOptions, RecordingTraceCommandResult>;
};

export type BoundRecordingCommands = {
  record: BoundRuntimeCommand<RecordingRecordCommandOptions, RecordingRecordCommandResult>;
  trace: BoundRuntimeCommand<RecordingTraceCommandOptions, RecordingTraceCommandResult>;
};

export const recordingCommands: RecordingCommands = {
  record: recordCommand,
  trace: traceCommand,
};

export function bindRecordingCommands(runtime: AgentDeviceRuntime): BoundRecordingCommands {
  return {
    record: (options) => recordingCommands.record(runtime, options),
    trace: (options) => recordingCommands.trace(runtime, options),
  };
}
