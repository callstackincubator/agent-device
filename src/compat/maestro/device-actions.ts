import type { SessionAction } from '../../daemon/types.ts';
import { AppError } from '../../utils/errors.ts';
import {
  action,
  assertOnlyKeys,
  isPlainRecord,
  normalizeToken,
  readBooleanLiteral,
  requireAppId,
  resolveMaestroString,
  resolveMaybeMaestroString,
  unsupportedMaestroSyntax,
} from './support.ts';
import type { MaestroFlowConfig, MaestroParseContext, PermissionCommand } from './types.ts';

const SUPPORTED_PERMISSION_TARGETS = new Set([
  'accessibility',
  'calendar',
  'camera',
  'contacts',
  'contacts-limited',
  'input-monitoring',
  'location',
  'location-always',
  'media-library',
  'microphone',
  'motion',
  'notifications',
  'photos',
  'reminders',
  'screen-recording',
  'siri',
]);

const BASIC_PERMISSION_STATES: Record<string, PermissionCommand> = {
  allow: 'grant',
  grant: 'grant',
  granted: 'grant',
  deny: 'deny',
  denied: 'deny',
  reset: 'reset',
  unset: 'reset',
  revoke: 'reset',
  revoked: 'reset',
};

const MODE_PERMISSION_STATES: Record<string, { command: PermissionCommand; mode: string }> = {
  limited: { command: 'grant', mode: 'limited' },
  full: { command: 'grant', mode: 'full' },
};

export function convertLaunchApp(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
): SessionAction {
  if (value === null || value === undefined) {
    return action('open', [resolveMaestroString(requireAppId(config, 'launchApp'), context)]);
  }
  if (typeof value === 'string') return action('open', [resolveMaestroString(value, context)]);
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'launchApp expects a string or map.');
  }
  assertOnlyKeys(value, 'launchApp', [
    'appId',
    'stopApp',
    'clearState',
    'clearKeychain',
    'arguments',
    'permissions',
    'launchArguments',
  ]);
  rejectTruthyLaunchOption(value, 'clearState');
  rejectTruthyLaunchOption(value, 'clearKeychain');
  rejectUnsupportedLaunchOption(value, 'arguments');
  rejectUnsupportedLaunchOption(value, 'permissions');
  rejectUnsupportedLaunchOption(value, 'launchArguments');
  const appId = resolveMaestroString(
    typeof value.appId === 'string' ? value.appId : requireAppId(config, 'launchApp'),
    context,
  );
  return action('open', [appId], { relaunch: value.stopApp === true });
}

export function convertStopApp(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
): SessionAction {
  if (value === null || value === undefined) {
    return action('close', [resolveMaestroString(requireAppId(config, 'stopApp'), context)]);
  }
  if (typeof value === 'string') return action('close', [resolveMaestroString(value, context)]);
  throw new AppError('INVALID_ARGS', 'stopApp expects a string appId or no value.');
}

export function convertSetAirplaneMode(
  value: unknown,
  context: MaestroParseContext,
): SessionAction {
  const enabled = readBooleanLiteral(resolveMaybeMaestroString(value, context), 'setAirplaneMode');
  return action('settings', ['airplane', enabled ? 'on' : 'off']);
}

export function convertSetLocation(value: unknown, context: MaestroParseContext): SessionAction {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'setLocation expects a map.');
  }
  assertOnlyKeys(value, 'setLocation', ['latitude', 'longitude', 'lat', 'lon', 'lng']);
  const latitude = readCoordinate(value.latitude ?? value.lat, 'setLocation.latitude', context);
  const longitude = readCoordinate(
    value.longitude ?? value.lon ?? value.lng,
    'setLocation.longitude',
    context,
  );
  return action('settings', ['location', 'set', latitude, longitude]);
}

export function convertSetOrientation(value: unknown, context: MaestroParseContext): SessionAction {
  const raw = resolveMaybeMaestroString(value, context);
  if (typeof raw !== 'string') {
    throw new AppError('INVALID_ARGS', 'setOrientation expects a string value.');
  }
  const orientation = normalizeToken(raw);
  switch (orientation) {
    case 'portrait':
    case 'landscape-left':
    case 'landscape-right':
      return action('rotate', [orientation]);
    case 'portrait-upside-down':
    case 'upside-down':
      return action('rotate', ['portrait-upside-down']);
    default:
      throw unsupportedMaestroSyntax(
        `Maestro setOrientation "${raw}" cannot be mapped to a supported rotate orientation.`,
      );
  }
}

export function convertSetPermissions(
  value: unknown,
  context: MaestroParseContext,
): SessionAction[] {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'setPermissions expects a map.');
  }
  return Object.entries(value).map(([rawTarget, rawState]) => {
    const { target, command, mode } = readPermissionMapping(rawTarget, rawState, context);
    return action('settings', ['permission', command, target, ...(mode ? [mode] : [])]);
  });
}

export function convertKillApp(
  value: unknown,
  config: MaestroFlowConfig,
  context: MaestroParseContext,
): SessionAction {
  if (value === null || value === undefined) {
    return action('close', [resolveMaestroString(requireAppId(config, 'killApp'), context)]);
  }
  if (typeof value === 'string') return action('close', [resolveMaestroString(value, context)]);
  throw new AppError('INVALID_ARGS', 'killApp expects a string appId or no value.');
}

export function convertStartRecording(value: unknown, context: MaestroParseContext): SessionAction {
  if (value === null || value === undefined) return action('record', ['start']);
  if (typeof value === 'string')
    return action('record', ['start', resolveMaestroString(value, context)]);
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'startRecording expects a string path, map, or no value.');
  }
  assertOnlyKeys(value, 'startRecording', ['path', 'file']);
  const rawPath = value.path ?? value.file;
  if (rawPath === undefined) return action('record', ['start']);
  if (typeof rawPath !== 'string') {
    throw new AppError('INVALID_ARGS', 'startRecording path must be a string.');
  }
  return action('record', ['start', resolveMaestroString(rawPath, context)]);
}

export function convertStopRecording(value: unknown): SessionAction {
  if (value !== null && value !== undefined) {
    throw new AppError('INVALID_ARGS', 'stopRecording expects no value.');
  }
  return action('record', ['stop']);
}

export function convertAssertTrue(value: unknown, context: MaestroParseContext): SessionAction[] {
  const resolved = resolveMaybeMaestroString(value, context);
  if (resolved === true || (typeof resolved === 'string' && normalizeToken(resolved) === 'true')) {
    return [];
  }
  if (
    resolved === false ||
    (typeof resolved === 'string' && normalizeToken(resolved) === 'false')
  ) {
    throw new AppError('INVALID_ARGS', 'Maestro assertTrue literal evaluated to false.');
  }
  throw unsupportedMaestroSyntax('Only literal Maestro assertTrue true/false is supported.');
}

function readCoordinate(value: unknown, name: string, context: MaestroParseContext): string {
  const resolved = resolveMaybeMaestroString(value, context);
  const numeric =
    typeof resolved === 'number'
      ? resolved
      : typeof resolved === 'string' && resolved.trim().length > 0
        ? Number(resolved)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    throw new AppError('INVALID_ARGS', `${name} must be a finite number.`);
  }
  return String(numeric);
}

function readPermissionMapping(
  rawTarget: string,
  rawState: unknown,
  context: MaestroParseContext,
): { target: string; command: PermissionCommand; mode?: string } {
  let target = normalizeToken(rawTarget);
  const resolvedState = resolveMaybeMaestroString(rawState, context);
  if (typeof resolvedState !== 'string') {
    throw new AppError('INVALID_ARGS', `setPermissions.${rawTarget} expects a string state.`);
  }
  const state = normalizeToken(resolvedState);
  if (target === 'location' && state === 'always') target = 'location-always';

  if (!SUPPORTED_PERMISSION_TARGETS.has(target)) {
    throw unsupportedMaestroSyntax(
      `Maestro setPermissions target "${rawTarget}" cannot be mapped to a supported settings permission target.`,
    );
  }

  const basicCommand = BASIC_PERMISSION_STATES[state];
  if (basicCommand) return { target, command: basicCommand };

  const modeMapping = MODE_PERMISSION_STATES[state];
  if (modeMapping) return { target, ...modeMapping };

  const locationCommand = readLocationPermissionCommand(target, state);
  if (locationCommand) return { target, command: locationCommand };

  throw unsupportedMaestroSyntax(
    `Maestro setPermissions state "${resolvedState}" cannot be mapped to grant, deny, or reset.`,
  );
}

function readLocationPermissionCommand(
  target: string,
  state: string,
): PermissionCommand | undefined {
  if (target === 'location-always' && state === 'always') return 'grant';
  if (target === 'location' && (state === 'while-in-use' || state === 'when-in-use')) {
    return 'grant';
  }
  return undefined;
}

function rejectTruthyLaunchOption(value: Record<string, unknown>, key: string): void {
  if (value[key] === true) {
    throw unsupportedMaestroSyntax(`Maestro launchApp ${key}: true is not supported yet.`);
  }
}

function rejectUnsupportedLaunchOption(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined) {
    throw unsupportedMaestroSyntax(`Maestro launchApp field "${key}" is not supported yet.`);
  }
}
