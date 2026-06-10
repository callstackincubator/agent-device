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
  DebugSymbolsResult,
  KeyboardCommandResult,
  SessionCloseResult,
} from '../client-types.ts';
import { formatSnapshotText } from '../utils/output.ts';
import { readCommandMessage } from '../utils/success-text.ts';
import type { CliOutput } from './command-contract.ts';

export function devicesCliOutput(result: AgentDeviceDevice[]): CliOutput {
  const data = { devices: result.map(serializeDevice) };
  return { data, text: result.map(formatDeviceLine).join('\n') };
}

export function appsCliOutput(params: {
  result: string[];
  appsFilter?: 'user-installed' | 'all';
}): CliOutput {
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

export function sessionCliOutput(
  result: { sessions: AgentDeviceSession[] } | { stateDir: string },
): CliOutput {
  if ('stateDir' in result) {
    return { data: result, text: result.stateDir };
  }
  const data = { sessions: result.sessions.map(serializeSessionListEntry) };
  return { data, text: JSON.stringify(data, null, 2) };
}

export function openCliOutput(result: AppOpenResult): CliOutput {
  const data = serializeOpenResult(result);
  const lines = [readCommandMessage(data)].filter((line): line is string => Boolean(line));
  if (typeof data.sessionStateDir === 'string') {
    lines.push(`Session state: ${data.sessionStateDir}`);
  }
  return { data, text: lines.join('\n') || null };
}

export function closeCliOutput(result: AppCloseResult | SessionCloseResult): CliOutput {
  return messageOutput(serializeCloseResult(result));
}

export function messageCliOutput(result: Record<string, unknown>): CliOutput {
  return messageOutput(result);
}

export function appStateCliOutput(result: AppStateCommandResult): CliOutput {
  return {
    data: result,
    text: formatAppState(result),
  };
}

export function keyboardCliOutput(result: KeyboardCommandResult): CliOutput {
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

export function clipboardCliOutput(result: ClipboardCommandResult): CliOutput {
  if (result.action === 'read') return { data: result, text: result.text };
  return messageOutput(result);
}

export function deployCliOutput(result: AppDeployResult): CliOutput {
  return messageOutput(serializeDeployResult(result));
}

export function debugSymbolsCliOutput(result: DebugSymbolsResult): CliOutput {
  const lines = [result.outPath, result.message];
  lines.push(...formatDebugCrashSummary(result));
  for (const image of result.matchedImages) {
    lines.push(`Matched: ${image.name} ${image.uuid}${image.arch ? ` ${image.arch}` : ''}`);
  }
  for (const warning of result.warnings ?? []) {
    lines.push(`Warning: ${warning}`);
  }
  return { data: result, text: lines.join('\n') };
}

function formatDebugCrashSummary(result: DebugSymbolsResult): string[] {
  const crash = result.crash;
  const lines = [
    `Crash: ${crash.appName ?? 'unknown app'}${crash.crashedThread === undefined ? '' : ` thread ${crash.crashedThread}`}`,
  ];
  if (crash.bundleId) lines.push(`Bundle: ${crash.bundleId}`);
  if (crash.exceptionType) lines.push(`Exception: ${crash.exceptionType}`);
  if (crash.terminationReason) lines.push(`Termination: ${crash.terminationReason}`);
  for (const frame of crash.topFrames) {
    lines.push(`Frame ${frame.index}: ${frame.image} ${frame.symbol ?? frame.address}`);
  }
  for (const finding of crash.findings) {
    lines.push(`Finding: ${finding}`);
  }
  return lines;
}

export function installFromSourceCliOutput(result: AppInstallFromSourceResult): CliOutput {
  return messageOutput(serializeInstallFromSourceResult(result));
}

export function snapshotCliOutput(params: {
  result: CaptureSnapshotResult;
  raw?: boolean;
  interactiveOnly?: boolean;
  scope?: string;
  depth?: number;
}): CliOutput {
  const data = serializeSnapshotResult(params.result);
  return {
    data,
    // Programmatic SDK callers can see `unchanged`; CLI --json hides it for schema compatibility.
    jsonData: withoutUnchanged(data),
    text: formatSnapshotText(data, {
      raw: params.raw,
      flatten: params.interactiveOnly,
      scoped: typeof params.scope === 'string' && params.scope.trim().length > 0,
      depthLimited: typeof params.depth === 'number',
    }),
  };
}

export function metroCliOutput(params: { result: unknown; action?: string }): CliOutput {
  return {
    data: params.result,
    text:
      params.action === 'reload'
        ? `Reloaded React Native apps via ${(params.result as { reloadUrl?: unknown }).reloadUrl}`
        : JSON.stringify(params.result, null, 2),
  };
}

export function bootCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const platform = data.platform ?? 'unknown';
  const device = data.device ?? data.id ?? 'unknown';
  return { data, text: `Boot ready: ${device} (${platform})` };
}

export function shutdownCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const platform = data.platform ?? 'unknown';
  const device = data.device ?? data.id ?? 'unknown';
  const shutdown = data.shutdown;
  const success =
    shutdown && typeof shutdown === 'object' && 'success' in shutdown
      ? (shutdown as { success?: unknown }).success === true
      : false;
  const status = success ? 'Shutdown' : 'Shutdown failed';
  return { data, text: `${status}: ${device} (${platform})` };
}

export function getCliOutput(params: { result: CommandRequestResult; format?: string }): CliOutput {
  const data = params.result as Record<string, unknown>;
  if (params.format === 'text') {
    return { data, text: typeof data.text === 'string' ? data.text : '' };
  }
  if (params.format === 'attrs') {
    return { data, text: JSON.stringify(data.node ?? {}, null, 2) };
  }
  return defaultCommandCliOutput(data);
}

export function findCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  if (typeof data.text === 'string') return { data, text: data.text };
  if (typeof data.found === 'boolean') return { data, text: `Found: ${data.found}` };
  if (data.node) return { data, text: JSON.stringify(data.node, null, 2) };
  return defaultCommandCliOutput(data);
}

export function isCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  return { data, text: `Passed: is ${data.predicate ?? 'assertion'}` };
}

export function tapCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const ref = data.ref ?? '';
  const x = data.x;
  const y = data.y;
  if (!ref || typeof x !== 'number' || typeof y !== 'number') {
    return defaultCommandCliOutput(data);
  }
  return { data, text: `Tapped @${ref} (${x}, ${y})` };
}

export function recordCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const outPath = typeof data.outPath === 'string' ? data.outPath : '';
  const chunks = readRecordingChunks(data);
  if (chunks.length <= 1) {
    return { data, text: formatRecordSingleOutput(data, outPath) };
  }

  const lines = ['Recording chunks:'];
  for (const chunk of chunks) {
    lines.push(`  ${chunk.index}: ${chunk.path}`);
  }
  if (typeof data.telemetryPath === 'string') {
    lines.push(`Telemetry: ${data.telemetryPath}`);
  }
  if (typeof data.warning === 'string') {
    lines.push(`Warning: ${data.warning}`);
  }
  if (typeof data.overlayWarning === 'string') {
    lines.push(`Overlay warning: ${data.overlayWarning}`);
  }
  return { data, text: lines.join('\n') };
}

function defaultCommandCliOutput(result: CommandRequestResult): CliOutput {
  return messageOutput(result as Record<string, unknown>);
}

function formatRecordSingleOutput(data: Record<string, unknown>, outPath: string): string {
  const lines: string[] = [];
  if (outPath) lines.push(outPath);
  if (typeof data.sessionStateDir === 'string')
    lines.push(`Session state: ${data.sessionStateDir}`);
  if (typeof data.warning === 'string') lines.push(`Warning: ${data.warning}`);
  if (typeof data.overlayWarning === 'string')
    lines.push(`Overlay warning: ${data.overlayWarning}`);
  return lines.join('\n');
}

function readRecordingChunks(
  data: Record<string, unknown>,
): Array<{ index: number; path: string }> {
  const rawChunks = data.chunks;
  if (!Array.isArray(rawChunks)) return [];
  return rawChunks.flatMap((chunk) => {
    if (!chunk || typeof chunk !== 'object') return [];
    const candidate = chunk as Record<string, unknown>;
    if (typeof candidate.index !== 'number' || typeof candidate.path !== 'string') return [];
    return [{ index: candidate.index, path: candidate.path }];
  });
}

function messageOutput(data: Record<string, unknown>): CliOutput {
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
