import type {
  BackendRecordingOptions,
  BackendRecordingResult,
  BackendTraceOptions,
  BackendTraceResult,
} from '../backend.ts';
import type { ArtifactDescriptor, FileOutputRef } from '../io.ts';
import type { CommandContext } from '../runtime.ts';
import { AppError } from '../utils/errors.ts';
import { successText } from '../utils/success-text.ts';
import { requireIntInRange } from '../utils/validation.ts';
import type { RuntimeCommand } from './index.ts';
import { reserveCommandOutput } from './io-policy.ts';
import { toBackendContext } from './selector-read-utils.ts';

export type RecordingRecordCommandOptions = CommandContext & {
  action: 'start' | 'stop';
  out?: FileOutputRef;
  fps?: number;
  quality?: number;
  hideTouches?: boolean;
};

export type RecordingTraceCommandOptions = CommandContext & {
  action: 'start' | 'stop';
  out?: FileOutputRef;
};

export type RecordingRecordCommandResult = {
  kind: 'recordingStarted' | 'recordingStopped';
  action: 'start' | 'stop';
  path?: string;
  telemetryPath?: string;
  artifact?: ArtifactDescriptor;
  backendResult?: Record<string, unknown>;
  warning?: string;
  message?: string;
};

export type RecordingTraceCommandResult = {
  kind: 'traceStarted' | 'traceStopped';
  action: 'start' | 'stop';
  outPath?: string;
  artifact?: ArtifactDescriptor;
  backendResult?: Record<string, unknown>;
  message?: string;
};

export const recordCommand: RuntimeCommand<
  RecordingRecordCommandOptions,
  RecordingRecordCommandResult
> = async (runtime, options): Promise<RecordingRecordCommandResult> => {
  const action = requireAction(options.action, 'record');
  const method =
    action === 'start' ? runtime.backend.startRecording : runtime.backend.stopRecording;
  if (!method) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `record ${action} is not supported by this backend`,
    );
  }

  const output = options.out
    ? await reserveCommandOutput(runtime, options.out, {
        field: 'path',
        ext: '.mp4',
      })
    : undefined;
  try {
    const backendOptions = normalizeRecordingOptions(options, output?.path);
    const result = await method.call(
      runtime.backend,
      toBackendContext(runtime, options),
      backendOptions,
    );
    const artifact = await output?.publish();
    return formatRecordingResult(action, result, artifact);
  } catch (error) {
    await output?.cleanup?.();
    throw error;
  }
};

export const traceCommand: RuntimeCommand<
  RecordingTraceCommandOptions,
  RecordingTraceCommandResult
> = async (runtime, options): Promise<RecordingTraceCommandResult> => {
  const action = requireAction(options.action, 'trace');
  const method = action === 'start' ? runtime.backend.startTrace : runtime.backend.stopTrace;
  if (!method) {
    throw new AppError('UNSUPPORTED_OPERATION', `trace ${action} is not supported by this backend`);
  }

  const output = options.out
    ? await reserveCommandOutput(runtime, options.out, {
        field: 'outPath',
        ext: '.trace',
      })
    : undefined;
  try {
    const backendOptions: BackendTraceOptions = {
      ...(output?.path ? { outPath: output.path } : {}),
    };
    const result = await method.call(
      runtime.backend,
      toBackendContext(runtime, options),
      backendOptions,
    );
    const artifact = await output?.publish();
    return formatTraceResult(action, result, artifact);
  } catch (error) {
    await output?.cleanup?.();
    throw error;
  }
};

function normalizeRecordingOptions(
  options: RecordingRecordCommandOptions,
  outPath: string | undefined,
): BackendRecordingOptions {
  const fps = options.fps === undefined ? undefined : requireIntInRange(options.fps, 'fps', 1, 60);
  const quality =
    options.quality === undefined
      ? undefined
      : requireIntInRange(options.quality, 'quality', 5, 10);
  return {
    ...(outPath ? { outPath } : {}),
    ...(fps !== undefined ? { fps } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(options.hideTouches !== undefined ? { showTouches: options.hideTouches !== true } : {}),
  };
}

function requireAction(action: string, command: string): 'start' | 'stop' {
  if (action === 'start' || action === 'stop') return action;
  throw new AppError('INVALID_ARGS', `${command} action must be start or stop`);
}

function formatRecordingResult(
  action: 'start' | 'stop',
  result: BackendRecordingResult,
  artifact: ArtifactDescriptor | undefined,
): RecordingRecordCommandResult {
  const backendResult = toBackendResult(result);
  return {
    kind: action === 'start' ? 'recordingStarted' : 'recordingStopped',
    action,
    ...(typeof result.path === 'string' ? { path: result.path } : {}),
    ...(typeof result.telemetryPath === 'string' ? { telemetryPath: result.telemetryPath } : {}),
    ...(typeof result.warning === 'string' ? { warning: result.warning } : {}),
    ...(artifact ? { artifact } : {}),
    ...(backendResult ? { backendResult } : {}),
    ...successText(action === 'start' ? 'Recording started' : 'Recording stopped'),
  };
}

function formatTraceResult(
  action: 'start' | 'stop',
  result: BackendTraceResult,
  artifact: ArtifactDescriptor | undefined,
): RecordingTraceCommandResult {
  const backendResult = toBackendResult(result);
  return {
    kind: action === 'start' ? 'traceStarted' : 'traceStopped',
    action,
    ...(typeof result.outPath === 'string' ? { outPath: result.outPath } : {}),
    ...(artifact ? { artifact } : {}),
    ...(backendResult ? { backendResult } : {}),
    ...successText(action === 'start' ? 'Trace started' : 'Trace stopped'),
  };
}

function toBackendResult(result: Record<string, unknown>): Record<string, unknown> | undefined {
  return result && typeof result === 'object' ? result : undefined;
}
