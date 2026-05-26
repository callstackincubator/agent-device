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
  AppStateCommandResult,
  AppCloseResult,
  AppDeployResult,
  AppInstallFromSourceResult,
  AppOpenResult,
  CaptureSnapshotResult,
  ClipboardCommandResult,
  CommandRequestResult,
  KeyboardCommandResult,
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

export function messageCliOutput(result: Record<string, unknown>): SemanticCliOutput {
  return messageOutput(result);
}

export function appStateCliOutput(result: AppStateCommandResult): SemanticCliOutput {
  return {
    data: result,
    text: formatAppState(result),
  };
}

export function keyboardCliOutput(result: KeyboardCommandResult): SemanticCliOutput {
  if (result.platform === 'android' && result.action === 'status') {
    const lines = [
      `Keyboard visible: ${result.visible === true ? 'yes' : 'no'}`,
      `Input type: ${result.type ?? result.inputType ?? 'unknown'}`,
      `Input owner: ${result.inputOwner ?? 'unknown'}`,
    ];
    if (result.inputMethodPackage) lines.push(`Input method: ${result.inputMethodPackage}`);
    if (result.focusedPackage) lines.push(`Focused package: ${result.focusedPackage}`);
    if (result.focusedResourceId) lines.push(`Focused resource: ${result.focusedResourceId}`);
    lines.push(`Next action: ${androidKeyboardNextAction(result.visible, result.inputOwner)}`);
    return { data: result, text: lines.join('\n') };
  }
  return messageOutput(result);
}

export function clipboardCliOutput(result: ClipboardCommandResult): SemanticCliOutput {
  if (result.action === 'read') return { data: result, text: result.text };
  return messageOutput(result);
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

export function bootCliOutput(result: CommandRequestResult): SemanticCliOutput {
  const data = result as Record<string, unknown>;
  const platform = data.platform ?? 'unknown';
  const device = data.device ?? data.id ?? 'unknown';
  return { data, text: `Boot ready: ${device} (${platform})` };
}

export function getCliOutput(params: {
  result: CommandRequestResult;
  format?: string;
}): SemanticCliOutput {
  const data = params.result as Record<string, unknown>;
  if (params.format === 'text') {
    return { data, text: typeof data.text === 'string' ? data.text : '' };
  }
  if (params.format === 'attrs') {
    return { data, text: JSON.stringify(data.node ?? {}, null, 2) };
  }
  return defaultCommandCliOutput(data);
}

export function findCliOutput(result: CommandRequestResult): SemanticCliOutput {
  const data = result as Record<string, unknown>;
  if (typeof data.text === 'string') return { data, text: data.text };
  if (typeof data.found === 'boolean') return { data, text: `Found: ${data.found}` };
  if (data.node) return { data, text: JSON.stringify(data.node, null, 2) };
  return defaultCommandCliOutput(data);
}

export function isCliOutput(result: CommandRequestResult): SemanticCliOutput {
  const data = result as Record<string, unknown>;
  return { data, text: `Passed: is ${data.predicate ?? 'assertion'}` };
}

export function tapCliOutput(result: CommandRequestResult): SemanticCliOutput {
  const data = result as Record<string, unknown>;
  const ref = data.ref ?? '';
  const x = data.x;
  const y = data.y;
  if (!ref || typeof x !== 'number' || typeof y !== 'number') {
    return defaultCommandCliOutput(data);
  }
  return { data, text: `Tapped @${ref} (${x}, ${y})` };
}

export function recordCliOutput(result: CommandRequestResult): SemanticCliOutput {
  const data = result as Record<string, unknown>;
  const outPath = typeof data.outPath === 'string' ? data.outPath : '';
  return { data, text: outPath };
}

function defaultCommandCliOutput(result: CommandRequestResult): SemanticCliOutput {
  return messageOutput(result as Record<string, unknown>);
}

function messageOutput(data: Record<string, unknown>): SemanticCliOutput {
  return { data, text: readCommandMessage(data) };
}

function formatAppState(data: AppStateCommandResult): string | null {
  if (data.platform === 'ios') {
    const lines = [`Foreground app: ${data.appName ?? data.appBundleId ?? 'unknown'}`];
    if (data.appBundleId) lines.push(`Bundle: ${data.appBundleId}`);
    if (data.source) lines.push(`Source: ${data.source}`);
    return lines.join('\n');
  }
  if (data.platform === 'android') {
    const lines = [`Foreground app: ${data.package ?? 'unknown'}`];
    if (data.activity) lines.push(`Activity: ${data.activity}`);
    return lines.join('\n');
  }
  return null;
}

function androidKeyboardNextAction(
  visible: boolean | undefined,
  inputOwner: KeyboardCommandResult['inputOwner'],
): string {
  if (inputOwner === 'ime') {
    return 'Focused input appears to be owned by the keyboard/IME; dismiss or change the IME before retrying text entry.';
  }
  if (visible === true) {
    return 'Keyboard is visible and focused input appears app-owned; fill/type can proceed.';
  }
  return 'Keyboard is hidden; focus an app field before type, or use fill with a concrete target.';
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
