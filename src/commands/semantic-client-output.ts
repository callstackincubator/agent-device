import {
  serializeCloseResult,
  serializeDeployResult,
  serializeDevice,
  serializeInstallFromSourceResult,
  serializeOpenResult,
  serializeSessionListEntry,
  serializeSnapshotResult,
} from '../client-shared.ts';
import type {
  AgentDeviceDevice,
  AgentDeviceSession,
  AppCloseResult,
  AppDeployResult,
  AppInstallFromSourceResult,
  AppOpenResult,
  CaptureSnapshotResult,
  SessionCloseResult,
} from '../client-types.ts';
import { formatSnapshotText } from '../utils/output.ts';
import { readCommandMessage } from '../utils/success-text.ts';
import type { SemanticCliOutput } from './semantic-contract.ts';

export function devicesCliOutput(result: AgentDeviceDevice[]): SemanticCliOutput {
  const data = { devices: result.map(serializeDevice) };
  return { data, text: result.map(formatDeviceLine).join('\n') };
}

export function appsCliOutput(params: {
  result: string[];
  appsFilter?: 'user-installed' | 'all';
}): SemanticCliOutput {
  const data = { apps: params.result };
  return {
    data,
    stderr:
      params.appsFilter === 'all'
        ? 'Showing all apps, including system apps.\n'
        : 'Showing user-installed apps. Use --all to include system apps.\n',
    text:
      params.result.length > 0
        ? params.result.join('\n')
        : params.appsFilter === 'all'
          ? 'No apps found.'
          : 'No user-installed apps found.',
  };
}

export function sessionCliOutput(result: { sessions: AgentDeviceSession[] }): SemanticCliOutput {
  const data = { sessions: result.sessions.map(serializeSessionListEntry) };
  return { data, text: JSON.stringify(data, null, 2) };
}

export function openCliOutput(result: AppOpenResult): SemanticCliOutput {
  return messageOutput(serializeOpenResult(result));
}

export function closeCliOutput(result: AppCloseResult | SessionCloseResult): SemanticCliOutput {
  return messageOutput(serializeCloseResult(result));
}

export function deployCliOutput(result: AppDeployResult): SemanticCliOutput {
  return messageOutput(serializeDeployResult(result));
}

export function installFromSourceCliOutput(result: AppInstallFromSourceResult): SemanticCliOutput {
  return messageOutput(serializeInstallFromSourceResult(result));
}

export function snapshotCliOutput(params: {
  result: CaptureSnapshotResult;
  raw?: boolean;
  interactiveOnly?: boolean;
}): SemanticCliOutput {
  const data = serializeSnapshotResult(params.result);
  return {
    data,
    // Programmatic SDK callers can see `unchanged`; CLI --json hides it for schema compatibility.
    jsonData: withoutUnchanged(data),
    text: formatSnapshotText(data, {
      raw: params.raw,
      flatten: params.interactiveOnly,
    }),
  };
}

export function metroCliOutput(params: { result: unknown; action?: string }): SemanticCliOutput {
  return {
    data: params.result,
    text:
      params.action === 'reload'
        ? `Reloaded React Native apps via ${(params.result as { reloadUrl?: unknown }).reloadUrl}`
        : JSON.stringify(params.result, null, 2),
  };
}

function messageOutput(data: Record<string, unknown>): SemanticCliOutput {
  return { data, text: readCommandMessage(data) };
}

function formatDeviceLine(device: AgentDeviceDevice): string {
  const kind = device.kind ? ` ${device.kind}` : '';
  const target = device.target ? ` target=${device.target}` : '';
  const booted = typeof device.booted === 'boolean' ? ` booted=${device.booted}` : '';
  return `${device.name} (${device.platform}${kind}${target})${booted}`;
}

function withoutUnchanged(data: Record<string, unknown>): Record<string, unknown> {
  const { unchanged: _unchanged, ...outputData } = data;
  return outputData;
}
