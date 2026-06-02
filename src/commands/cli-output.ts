import type { CommandRequestResult } from '../client.ts';
import type { CommandName } from './command-metadata.ts';
import type { CliOutput } from './command-contract.ts';
import {
  appStateCliOutput,
  appsCliOutput,
  bootCliOutput,
  clipboardCliOutput,
  closeCliOutput,
  deployCliOutput,
  devicesCliOutput,
  findCliOutput,
  getCliOutput,
  installFromSourceCliOutput,
  isCliOutput,
  keyboardCliOutput,
  messageCliOutput,
  metroCliOutput,
  openCliOutput,
  recordCliOutput,
  sessionCliOutput,
  snapshotCliOutput,
  tapCliOutput,
} from './client-output.ts';
import {
  batchCliOutput,
  logsCliOutput,
  networkCliOutput,
  perfCliOutput,
} from './runtime-output.ts';

type CliOutputFormatter = (params: {
  input: Record<string, unknown>;
  result: unknown;
}) => CliOutput;

function resultOutput<TResult>(formatter: (result: TResult) => CliOutput): CliOutputFormatter {
  return ({ result }) => formatter(result as TResult);
}

const messageOutput = resultOutput(messageCliOutput);

const cliOutputFormatters: Partial<Record<CommandName, CliOutputFormatter>> = {
  boot: resultOutput(bootCliOutput),
  click: resultOutput(tapCliOutput),
  press: resultOutput(tapCliOutput),
  batch: resultOutput(batchCliOutput),
  devices: resultOutput(devicesCliOutput),
  apps: ({ input, result }) =>
    appsCliOutput({
      result: result as Parameters<typeof appsCliOutput>[0]['result'],
      appsFilter: input.appsFilter as Parameters<typeof appsCliOutput>[0]['appsFilter'],
    }),
  session: resultOutput(sessionCliOutput),
  open: resultOutput(openCliOutput),
  close: resultOutput(closeCliOutput),
  install: resultOutput(deployCliOutput),
  reinstall: resultOutput(deployCliOutput),
  'install-from-source': resultOutput(installFromSourceCliOutput),
  snapshot: ({ input, result }) =>
    snapshotCliOutput({
      result: result as Parameters<typeof snapshotCliOutput>[0]['result'],
      raw: input.raw as boolean | undefined,
      interactiveOnly: input.interactiveOnly as boolean | undefined,
      scope: input.scope as string | undefined,
      depth: input.depth as number | undefined,
    }),
  wait: messageOutput,
  alert: messageOutput,
  appstate: resultOutput(appStateCliOutput),
  back: messageOutput,
  home: messageOutput,
  rotate: messageOutput,
  'app-switcher': messageOutput,
  keyboard: resultOutput(keyboardCliOutput),
  clipboard: resultOutput(clipboardCliOutput),
  get: ({ input, result }) =>
    getCliOutput({
      result: result as CommandRequestResult,
      format: input.format as Parameters<typeof getCliOutput>[0]['format'],
    }),
  is: resultOutput(isCliOutput),
  find: resultOutput(findCliOutput),
  perf: resultOutput(perfCliOutput),
  prepare: messageOutput,
  logs: resultOutput(logsCliOutput),
  network: resultOutput(networkCliOutput),
  record: resultOutput(recordCliOutput),
  metro: ({ input, result }) =>
    metroCliOutput({ result, action: input.action as string | undefined }),
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
