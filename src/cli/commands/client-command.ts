import type {
  AlertCommandOptions,
  AppStateCommandResult,
  ClipboardCommandOptions,
  ClipboardCommandResult,
  KeyboardCommandOptions,
  RotateCommandOptions,
  WaitCommandOptions,
} from '../../client.ts';
import { CLIENT_COMMANDS } from '../../client-command-registry.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { AppError } from '../../utils/errors.ts';
import { parseWaitArgs } from '../../daemon/handlers/snapshot.ts';
import { parseDeviceRotation } from '../../core/device-rotation.ts';
import { buildSelectionOptions, writeCommandMessage, writeCommandOutput } from './shared.ts';
import type { ClientCommandHandlerMap } from './router.ts';

export const clientCommandMethodHandlers = {
  [CLIENT_COMMANDS.wait]: async ({ positionals, flags, client }) => {
    writeCommandMessage(flags, await client.command.wait(readWaitOptions(positionals, flags)));
    return true;
  },
  [CLIENT_COMMANDS.alert]: async ({ positionals, flags, client }) => {
    writeCommandMessage(flags, await client.command.alert(readAlertOptions(positionals, flags)));
    return true;
  },
  [CLIENT_COMMANDS.appState]: async ({ flags, client }) => {
    const result = await client.command.appState(buildSelectionOptions(flags));
    writeCommandOutput(flags, result, () => formatAppState(result));
    return true;
  },
  [CLIENT_COMMANDS.back]: async ({ flags, client }) => {
    writeCommandMessage(
      flags,
      await client.command.back({ ...buildSelectionOptions(flags), mode: flags.backMode }),
    );
    return true;
  },
  [CLIENT_COMMANDS.home]: async ({ flags, client }) => {
    writeCommandMessage(flags, await client.command.home(buildSelectionOptions(flags)));
    return true;
  },
  [CLIENT_COMMANDS.rotate]: async ({ positionals, flags, client }) => {
    writeCommandMessage(flags, await client.command.rotate(readRotateOptions(positionals, flags)));
    return true;
  },
  [CLIENT_COMMANDS.appSwitcher]: async ({ flags, client }) => {
    writeCommandMessage(flags, await client.command.appSwitcher(buildSelectionOptions(flags)));
    return true;
  },
  [CLIENT_COMMANDS.keyboard]: async ({ positionals, flags, client }) => {
    writeCommandMessage(
      flags,
      await client.command.keyboard(readKeyboardOptions(positionals, flags)),
    );
    return true;
  },
  [CLIENT_COMMANDS.clipboard]: async ({ positionals, flags, client }) => {
    writeClipboardOutput(
      flags,
      await client.command.clipboard(readClipboardOptions(positionals, flags)),
    );
    return true;
  },
} satisfies ClientCommandHandlerMap;

function readWaitOptions(positionals: string[], flags: CliFlags): WaitCommandOptions {
  const parsed = parseWaitArgs(positionals);
  if (!parsed) {
    throw new AppError(
      'INVALID_ARGS',
      'wait requires <ms>, text <text>, @ref, or <selector> [timeoutMs].',
    );
  }

  const base = {
    ...buildSelectionOptions(flags),
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  };

  if (parsed.kind === 'sleep') return { ...base, durationMs: parsed.durationMs };
  if (parsed.kind === 'text') {
    if (!parsed.text) throw new AppError('INVALID_ARGS', 'wait requires text.');
    return { ...base, text: parsed.text, ...readTimeoutOption(parsed.timeoutMs) };
  }
  if (parsed.kind === 'ref') {
    return { ...base, ref: parsed.rawRef, ...readTimeoutOption(parsed.timeoutMs) };
  }
  return {
    ...base,
    selector: parsed.selectorExpression,
    ...readTimeoutOption(parsed.timeoutMs),
  };
}

function readTimeoutOption(timeoutMs: number | null): { timeoutMs?: number } {
  return timeoutMs === null ? {} : { timeoutMs };
}

function readAlertOptions(positionals: string[], flags: CliFlags): AlertCommandOptions {
  if (positionals.length > 2) {
    throw new AppError('INVALID_ARGS', 'alert accepts at most action and timeout arguments.');
  }
  const action = readAlertAction(positionals[0]);
  const timeoutMs = readFiniteNumber(positionals[1], 'alert timeout');
  return {
    ...buildSelectionOptions(flags),
    ...(action ? { action } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function readRotateOptions(positionals: string[], flags: CliFlags): RotateCommandOptions {
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'rotate accepts exactly one orientation argument.');
  }
  return {
    ...buildSelectionOptions(flags),
    orientation: parseDeviceRotation(positionals[0]),
  };
}

function readKeyboardOptions(positionals: string[], flags: CliFlags): KeyboardCommandOptions {
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'keyboard accepts at most one action argument.');
  }
  const action = readKeyboardAction(positionals[0]);
  return {
    ...buildSelectionOptions(flags),
    ...(action ? { action } : {}),
  };
}

function readClipboardOptions(positionals: string[], flags: CliFlags): ClipboardCommandOptions {
  const action = positionals[0]?.toLowerCase();
  if (action !== 'read' && action !== 'write') {
    throw new AppError('INVALID_ARGS', 'clipboard requires a subcommand: read or write.');
  }
  const base = buildSelectionOptions(flags);
  if (action === 'read') {
    if (positionals.length !== 1) {
      throw new AppError('INVALID_ARGS', 'clipboard read does not accept additional arguments.');
    }
    return { ...base, action };
  }
  if (positionals.length < 2) {
    throw new AppError('INVALID_ARGS', 'clipboard write requires text.');
  }
  return {
    ...base,
    action,
    text: positionals.slice(1).join(' '),
  };
}

function readAlertAction(value: string | undefined): AlertCommandOptions['action'] | undefined {
  const action = value?.toLowerCase();
  if (
    action === undefined ||
    action === 'get' ||
    action === 'accept' ||
    action === 'dismiss' ||
    action === 'wait'
  ) {
    return action;
  }
  throw new AppError('INVALID_ARGS', 'alert action must be get, accept, dismiss, or wait.');
}

function readKeyboardAction(
  value: string | undefined,
): KeyboardCommandOptions['action'] | undefined {
  const action = value?.toLowerCase();
  if (action === 'get') return 'status';
  if (action === undefined || action === 'status' || action === 'dismiss') {
    return action;
  }
  throw new AppError('INVALID_ARGS', 'keyboard action must be status, get, or dismiss.');
}

function readFiniteNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new AppError('INVALID_ARGS', `${label} must be a finite number.`);
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

function writeClipboardOutput(flags: CliFlags, result: ClipboardCommandResult): void {
  if (flags.json) {
    writeCommandOutput(flags, result);
    return;
  }
  if (result.action === 'read') {
    process.stdout.write(`${result.text}\n`);
    return;
  }
  writeCommandMessage(flags, result);
}
