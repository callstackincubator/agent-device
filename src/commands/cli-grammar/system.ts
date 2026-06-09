import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import type { ClipboardCommandOptions } from '../../client-types.ts';
import { parseDeviceRotation } from '../../core/device-rotation.ts';
import type { BackMode } from '../../core/back-mode.ts';
import { AppError } from '../../utils/errors.ts';
import { compactRecord } from '../command-input.ts';
import {
  commonInputFromFlags,
  direct,
  optionalString,
  request,
  requiredDaemonString,
} from './common.ts';
import type { CliReader, DaemonWriter } from './types.ts';

export const systemCliReaders = {
  appstate: (_positionals, flags) => commonInputFromFlags(flags),
  home: (_positionals, flags) => commonInputFromFlags(flags),
  'app-switcher': (_positionals, flags) => commonInputFromFlags(flags),
  back: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    mode: flags.backMode,
  }),
  rotate: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    orientation: parseDeviceRotation(positionals[0]),
  }),
  keyboard: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readKeyboardInput(positionals),
  }),
  clipboard: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readClipboardInput(positionals),
  }),
  'react-native': (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readReactNativeAction(positionals[0]),
  }),
} satisfies Record<string, CliReader>;

export const systemDaemonWriters = {
  appstate: direct(PUBLIC_COMMANDS.appState),
  back: (input) =>
    request(PUBLIC_COMMANDS.back, [], { ...input, backMode: readBackMode(input.mode) }),
  home: direct(PUBLIC_COMMANDS.home),
  rotate: direct(PUBLIC_COMMANDS.rotate, (input) => [
    requiredDaemonString(input.orientation, 'rotate requires orientation'),
  ]),
  'app-switcher': direct(PUBLIC_COMMANDS.appSwitcher),
  keyboard: direct(PUBLIC_COMMANDS.keyboard, (input) => optionalString(input.action)),
  clipboard: direct(PUBLIC_COMMANDS.clipboard, (input) =>
    clipboardPositionals(input as ClipboardCommandOptions),
  ),
  'react-native': direct(PUBLIC_COMMANDS.reactNative, (input) => [
    requiredDaemonString(input.action, 'react-native requires action'),
  ]),
} satisfies Record<string, DaemonWriter>;

function readBackMode(value: unknown): BackMode | undefined {
  return value === 'in-app' || value === 'system' ? value : undefined;
}

function clipboardPositionals(input: ClipboardCommandOptions): string[] {
  return input.action === 'read' ? ['read'] : ['write', input.text];
}

function readKeyboardInput(positionals: string[]): Record<string, unknown> {
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'keyboard accepts at most one action argument.');
  }
  return compactRecord({ action: readKeyboardAction(positionals[0]) });
}

function readClipboardInput(positionals: string[]): Record<string, unknown> {
  const action = positionals[0]?.toLowerCase();
  if (action !== 'read' && action !== 'write') {
    throw new AppError('INVALID_ARGS', 'clipboard requires a subcommand: read or write.');
  }
  if (action === 'read') {
    if (positionals.length !== 1) {
      throw new AppError('INVALID_ARGS', 'clipboard read does not accept additional arguments.');
    }
    return { action };
  }
  if (positionals.length < 2) {
    throw new AppError('INVALID_ARGS', 'clipboard write requires text.');
  }
  return { action, text: positionals.slice(1).join(' ') };
}

function readKeyboardAction(
  value: string | undefined,
): 'status' | 'dismiss' | 'enter' | 'return' | undefined {
  const action = value?.toLowerCase();
  if (action === 'get') return 'status';
  if (
    action === undefined ||
    action === 'status' ||
    action === 'dismiss' ||
    action === 'enter' ||
    action === 'return'
  ) {
    return action;
  }
  throw new AppError(
    'INVALID_ARGS',
    'keyboard action must be status, get, dismiss, enter, or return.',
  );
}

function readReactNativeAction(value: string | undefined): 'dismiss-overlay' {
  if (value === 'dismiss-overlay') return value;
  throw new AppError('INVALID_ARGS', 'react-native supports only: dismiss-overlay');
}
