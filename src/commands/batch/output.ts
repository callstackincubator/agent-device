import type { CommandRequestResult } from '../../client-types.ts';
import { readCommandMessage } from '../../utils/success-text.ts';
import type { CliOutput } from '../command-contract.ts';
import { readRecord, resultOutput, type CliOutputFormatter } from '../output-common.ts';

function batchCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const total = typeof data.total === 'number' ? data.total : 0;
  const executed = typeof data.executed === 'number' ? data.executed : 0;
  const durationMs = typeof data.totalDurationMs === 'number' ? data.totalDurationMs : undefined;
  const lines = [
    `Batch completed: ${executed}/${total} steps${durationMs !== undefined ? ` in ${durationMs}ms` : ''}`,
  ];
  const results = Array.isArray(data.results) ? data.results : [];
  for (const entry of results) {
    const line = renderBatchStepLine(entry);
    if (line) lines.push(line);
  }
  return { data, text: lines.join('\n') };
}

export const batchCliOutputFormatters = {
  batch: resultOutput(batchCliOutput),
} as const satisfies Record<string, CliOutputFormatter>;

function renderBatchStepLine(entry: unknown): string | undefined {
  const result = readRecord(entry);
  if (!result) return undefined;
  const step = typeof result.step === 'number' ? result.step : undefined;
  const command = typeof result.command === 'string' ? result.command : 'step';
  const stepOk = result.ok !== false;
  const description = readBatchStepDescription(result, stepOk, command);
  const prefix = step !== undefined ? `${step}. ` : '- ';
  const durationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
  const durationSuffix = durationMs !== undefined ? ` (${durationMs}ms)` : '';
  return `${prefix}${stepOk ? 'OK' : 'FAILED'} ${description}${durationSuffix}`;
}

function readBatchStepDescription(
  result: Record<string, unknown>,
  stepOk: boolean,
  command: string,
): string {
  if (stepOk) return readCommandMessage(readRecord(result.data)) ?? command;
  return readBatchStepFailure(readRecord(result.error)) ?? command;
}

function readBatchStepFailure(error: Record<string, unknown> | undefined): string | null {
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : null;
}
