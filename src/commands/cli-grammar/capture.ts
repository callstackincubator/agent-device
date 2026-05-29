import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import type {
  AlertCommandOptions,
  CaptureScreenshotOptions,
  SettingsUpdateOptions,
  WaitCommandOptions,
} from '../../client-types.ts';
import { parseTimeout } from '../../daemon/handlers/parse-utils.ts';
import { splitSelectorFromArgs, tryParseSelectorChain } from '../../daemon/selectors.ts';
import type { CliFlags } from '../../utils/cli-flags.ts';
import { AppError } from '../../utils/errors.ts';
import { readLocationCoordinate } from '../../utils/location-coordinates.ts';
import {
  screenshotFlagsFromOptions,
  screenshotOptionsFromFlags,
} from '../capture-screenshot-options.ts';
import { compactRecord } from '../command-input.ts';
import {
  commonInputFromFlags,
  direct,
  isOneOf,
  optionalNumber,
  optionalString,
  readFiniteNumber,
  request,
  requiredDaemonString,
  selectionOptionsFromFlags,
  selectorSnapshotOptionsFromFlags,
  setOf,
} from './common.ts';
import type { CliReader, DaemonWriter, WaitParsed } from './types.ts';

export const captureCliReaders = {
  snapshot: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    interactiveOnly: flags.snapshotInteractiveOnly,
    compact: flags.snapshotCompact,
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
    forceFull: flags.snapshotForceFull,
  }),
  screenshot: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    path: positionals[0] ?? flags.out,
    ...screenshotOptionsFromFlags(flags),
  }),
  diff: (positionals, flags) => {
    if (positionals[0] !== 'snapshot') {
      throw new AppError('INVALID_ARGS', 'Only diff snapshot is available through this parser.');
    }
    return {
      ...commonInputFromFlags(flags),
      kind: 'snapshot',
      out: flags.out,
      interactiveOnly: flags.snapshotInteractiveOnly,
      compact: flags.snapshotCompact,
      depth: flags.snapshotDepth,
      scope: flags.snapshotScope,
      raw: flags.snapshotRaw,
    };
  },
  wait: (positionals, flags) => readWaitOptionsFromPositionals(positionals, flags),
  alert: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    ...readAlertInput(positionals),
  }),
  settings: (positionals, flags) => readSettingsOptionsFromPositionals(positionals, flags),
} satisfies Record<string, CliReader>;

export const captureDaemonWriters = {
  snapshot: direct(PUBLIC_COMMANDS.snapshot),
  screenshot: (input) =>
    request(PUBLIC_COMMANDS.screenshot, optionalString(input.path), {
      ...input,
      ...screenshotFlagsFromOptions(input as CaptureScreenshotOptions),
    }),
  diff: direct(PUBLIC_COMMANDS.diff, (input) => [
    requiredDaemonString(input.kind, 'diff requires kind'),
  ]),
  wait: direct(PUBLIC_COMMANDS.wait, (input) => waitPositionals(input as WaitCommandOptions)),
  alert: direct(PUBLIC_COMMANDS.alert, (input) => alertPositionals(input as AlertCommandOptions)),
  settings: direct(PUBLIC_COMMANDS.settings, (input) =>
    settingsPositionals(input as SettingsUpdateOptions),
  ),
} satisfies Record<string, DaemonWriter>;

function readWaitOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): WaitCommandOptions {
  const parsed = parseWaitPositionals(positionals);
  if (!parsed) {
    throw new AppError(
      'INVALID_ARGS',
      'wait requires <ms>, text <text>, @ref, or <selector> [timeoutMs].',
    );
  }
  const base = {
    ...selectionOptionsFromFlags(flags),
    ...selectorSnapshotOptionsFromFlags(flags),
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

export function parseWaitPositionals(args: string[]): WaitParsed | null {
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  const sleepMs = parseTimeout(firstArg);
  if (sleepMs !== null) return { kind: 'sleep', durationMs: sleepMs };
  const timeoutMs = parseTimeout(args[args.length - 1]);
  if (firstArg === 'text') {
    const text = timeoutMs !== null ? args.slice(1, -1).join(' ') : args.slice(1).join(' ');
    return { kind: 'text', text: text.trim(), timeoutMs };
  }
  if (firstArg.startsWith('@')) return { kind: 'ref', rawRef: firstArg, timeoutMs };
  const argsWithoutTimeout = timeoutMs !== null ? args.slice(0, -1) : args.slice();
  const split = splitSelectorFromArgs(argsWithoutTimeout);
  if (split && split.rest.length === 0 && tryParseSelectorChain(split.selectorExpression)) {
    return { kind: 'selector', selectorExpression: split.selectorExpression, timeoutMs };
  }
  const text = timeoutMs !== null ? args.slice(0, -1).join(' ') : args.join(' ');
  return { kind: 'text', text: text.trim(), timeoutMs };
}

// fallow-ignore-next-line complexity
function waitPositionals(options: WaitCommandOptions): string[] {
  const targets = [
    options.durationMs !== undefined ? 'durationMs' : undefined,
    options.text !== undefined ? 'text' : undefined,
    options.ref !== undefined ? 'ref' : undefined,
    options.selector !== undefined ? 'selector' : undefined,
  ].filter(Boolean);
  if (targets.length !== 1) {
    throw new AppError(
      'INVALID_ARGS',
      'wait command requires exactly one of durationMs, text, ref, or selector.',
    );
  }
  if (options.durationMs !== undefined) return [String(options.durationMs)];
  const timeout = optionalNumber(options.timeoutMs);
  if (options.text !== undefined) return ['text', options.text, ...timeout];
  if (options.ref !== undefined) return [options.ref, ...timeout];
  const selector = options.selector!;
  if (!tryParseSelectorChain(selector)) {
    throw new AppError('INVALID_ARGS', `Invalid wait selector: ${selector}`);
  }
  return [selector, ...timeout];
}

function alertPositionals(input: AlertCommandOptions): string[] {
  return [input.action ?? 'get', ...optionalNumber(input.timeoutMs)];
}

function readAlertInput(positionals: string[]): Record<string, unknown> {
  if (positionals.length > 2) {
    throw new AppError('INVALID_ARGS', 'alert accepts at most action and timeout arguments.');
  }
  const action = readAlertAction(positionals[0]);
  const timeoutMs = readFiniteNumber(positionals[1], 'alert timeout');
  return compactRecord({ action, timeoutMs });
}

function readAlertAction(
  value: string | undefined,
): 'get' | 'accept' | 'dismiss' | 'wait' | undefined {
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

function readTimeoutOption(timeoutMs: number | null): { timeoutMs?: number } {
  return timeoutMs === null ? {} : { timeoutMs };
}

// fallow-ignore-next-line complexity
function readSettingsOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): SettingsUpdateOptions {
  const base = selectionOptionsFromFlags(flags);
  const setting = positionals[0];
  const state = positionals[1];
  if (isOneOf(setting, ON_OFF_SETTINGS) && isOneOf(state, ON_OFF_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'location' && state === 'set') {
    return {
      ...base,
      setting,
      state,
      latitude: readLocationCoordinate(positionals[2], 'latitude'),
      longitude: readLocationCoordinate(positionals[3], 'longitude'),
    };
  }
  if (setting === 'appearance' && isOneOf(state, APPEARANCE_STATES)) {
    return { ...base, setting, state };
  }
  if (isOneOf(setting, BIOMETRIC_SETTINGS) && isOneOf(state, BIOMETRIC_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'fingerprint' && isOneOf(state, FINGERPRINT_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'permission' && isOneOf(state, PERMISSION_STATES)) {
    return {
      ...base,
      setting,
      state,
      permission: readPermission(positionals[2]),
      mode: readPermissionMode(positionals[3]),
    };
  }
  throw new AppError('INVALID_ARGS', 'Invalid settings arguments.');
}

function settingsPositionals(input: SettingsUpdateOptions): string[] {
  if (input.setting === 'location' && input.state === 'set') {
    return [input.setting, input.state, String(input.latitude), String(input.longitude)];
  }
  if (input.setting === 'permission') {
    return [input.setting, input.state, input.permission, ...optionalString(input.mode)];
  }
  return [input.setting, input.state];
}

function readPermission(value: string | undefined): PermissionTarget {
  if (isOneOf(value, PERMISSION_TARGETS)) return value;
  throw new AppError('INVALID_ARGS', 'settings permission requires a permission target.');
}

function readPermissionMode(value: string | undefined): 'full' | 'limited' | undefined {
  if (value === undefined || value === 'full' || value === 'limited') return value;
  throw new AppError('INVALID_ARGS', 'settings permission mode must be full or limited.');
}

type PermissionTarget = Extract<SettingsUpdateOptions, { setting: 'permission' }>['permission'];
type OnOffSetting = Extract<SettingsUpdateOptions, { state: 'on' | 'off' }>['setting'];
type OnOffState = Extract<SettingsUpdateOptions, { state: 'on' | 'off' }>['state'];
type BiometricSetting = Extract<
  SettingsUpdateOptions,
  { setting: 'faceid' | 'touchid' }
>['setting'];
type BiometricState = Extract<SettingsUpdateOptions, { setting: 'faceid' | 'touchid' }>['state'];
type FingerprintState = Extract<SettingsUpdateOptions, { setting: 'fingerprint' }>['state'];
type AppearanceState = Extract<SettingsUpdateOptions, { setting: 'appearance' }>['state'];
type PermissionState = Extract<SettingsUpdateOptions, { setting: 'permission' }>['state'];

const ON_OFF_SETTINGS = setOf<OnOffSetting>('wifi', 'airplane', 'location', 'animations');
const ON_OFF_STATES = setOf<OnOffState>('on', 'off');
const APPEARANCE_STATES = setOf<AppearanceState>('light', 'dark', 'toggle');
const BIOMETRIC_SETTINGS = setOf<BiometricSetting>('faceid', 'touchid');
const BIOMETRIC_STATES = setOf<BiometricState>('match', 'nonmatch', 'enroll', 'unenroll');
const FINGERPRINT_STATES = setOf<FingerprintState>('match', 'nonmatch');
const PERMISSION_STATES = setOf<PermissionState>('grant', 'deny', 'reset');
const PERMISSION_TARGETS = setOf<PermissionTarget>(
  'camera',
  'microphone',
  'photos',
  'contacts',
  'contacts-limited',
  'notifications',
  'calendar',
  'location',
  'location-always',
  'media-library',
  'motion',
  'reminders',
  'siri',
  'accessibility',
  'screen-recording',
  'input-monitoring',
);
