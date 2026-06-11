import type { AgentDeviceRuntime } from '../../../runtime-contract.ts';
import type { RuntimeCommand } from '../../runtime-types.ts';
import {
  logsCommand,
  networkCommand,
  perfCommand,
  type DiagnosticsLogsCommandOptions,
  type DiagnosticsLogsCommandResult,
  type DiagnosticsNetworkCommandOptions,
  type DiagnosticsNetworkCommandResult,
  type DiagnosticsPerfCommandOptions,
  type DiagnosticsPerfCommandResult,
} from './diagnostics.ts';

export type DiagnosticsCommands = {
  logs: RuntimeCommand<DiagnosticsLogsCommandOptions | undefined, DiagnosticsLogsCommandResult>;
  network: RuntimeCommand<
    DiagnosticsNetworkCommandOptions | undefined,
    DiagnosticsNetworkCommandResult
  >;
  perf: RuntimeCommand<DiagnosticsPerfCommandOptions | undefined, DiagnosticsPerfCommandResult>;
};

export type BoundObservabilityCommands = {
  logs: (options?: DiagnosticsLogsCommandOptions) => Promise<DiagnosticsLogsCommandResult>;
  network: (options?: DiagnosticsNetworkCommandOptions) => Promise<DiagnosticsNetworkCommandResult>;
  perf: (options?: DiagnosticsPerfCommandOptions) => Promise<DiagnosticsPerfCommandResult>;
};

export const diagnosticsCommands: DiagnosticsCommands = {
  logs: logsCommand,
  network: networkCommand,
  perf: perfCommand,
};

export function bindObservabilityCommands(runtime: AgentDeviceRuntime): BoundObservabilityCommands {
  return {
    logs: (options) => diagnosticsCommands.logs(runtime, options),
    network: (options) => diagnosticsCommands.network(runtime, options),
    perf: (options) => diagnosticsCommands.perf(runtime, options),
  };
}
