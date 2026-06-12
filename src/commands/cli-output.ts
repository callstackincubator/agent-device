import { batchCliOutputFormatters } from './batch/output.ts';
import { captureCliOutputFormatters } from './capture/output.ts';
import type { CliOutput } from './command-contract.ts';
import { debuggingCliOutputFormatters } from './debugging/output.ts';
import { interactionCliOutputFormatters } from './interaction/output.ts';
import { managementCliOutputFormatters } from './management/output.ts';
import { metroCliOutputFormatters } from './metro/output.ts';
import { observabilityCliOutputFormatters } from './observability/output.ts';
import { perfCliOutputFormatters } from './perf/output.ts';
import type { CliOutputFormatter } from './output-common.ts';
import { recordingCliOutputFormatters } from './recording/output.ts';
import { systemCliOutputFormatters } from './system/output.ts';
import type { CommandName } from './command-metadata.ts';

const cliOutputFormatters: Partial<Record<CommandName, CliOutputFormatter>> = {
  ...managementCliOutputFormatters,
  ...captureCliOutputFormatters,
  ...systemCliOutputFormatters,
  ...interactionCliOutputFormatters,
  ...observabilityCliOutputFormatters,
  ...perfCliOutputFormatters,
  ...debuggingCliOutputFormatters,
  ...batchCliOutputFormatters,
  ...recordingCliOutputFormatters,
  ...metroCliOutputFormatters,
};

export function formatCliOutput(params: {
  name: CommandName;
  input: unknown;
  result: unknown;
}): CliOutput | undefined {
  return cliOutputFormatters[params.name]?.({
    input: (params.input ?? {}) as Record<string, unknown>,
    result: params.result,
  });
}
