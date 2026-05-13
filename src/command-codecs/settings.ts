import type { SettingsUpdateOptions } from '../client-types.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { AppError } from '../utils/errors.ts';
import { readLocationCoordinate } from '../utils/location-coordinates.ts';
import { selectionOptionsFromFlags } from './flags.ts';

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

export function readSettingsOptionsFromPositionals(
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

export function settingsOptionsToPositionals(options: SettingsUpdateOptions): string[] {
  if (options.setting === 'location' && options.state === 'set') {
    return [options.setting, options.state, String(options.latitude), String(options.longitude)];
  }
  if (options.setting === 'permission') {
    return [options.setting, options.state, options.permission, ...optionalString(options.mode)];
  }
  return [options.setting, options.state];
}

function readPermission(value: string | undefined): PermissionTarget {
  if (isOneOf(value, PERMISSION_TARGETS)) return value;
  throw new AppError('INVALID_ARGS', 'settings permission requires a permission target.');
}

function readPermissionMode(value: string | undefined): 'full' | 'limited' | undefined {
  if (value === undefined || value === 'full' || value === 'limited') return value;
  throw new AppError('INVALID_ARGS', 'settings permission mode must be full or limited.');
}

function optionalString(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

function setOf<T extends string>(...values: T[]): ReadonlySet<T> {
  return new Set(values);
}

function isOneOf<T extends string>(value: string | undefined, values: ReadonlySet<T>): value is T {
  return value !== undefined && values.has(value as T);
}
