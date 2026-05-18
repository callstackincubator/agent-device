import { parseAllDocuments } from 'yaml';
import { AppError } from '../../utils/errors.ts';
import type { SessionAction } from '../types.ts';
import type { ParsedReplayScript, ReplayScriptMetadata } from './session-replay-script.ts';

type MaestroFlowConfig = {
  appId?: string;
  env?: Record<string, string>;
};

type MaestroReplayFlow = ParsedReplayScript & {
  metadata: ReplayScriptMetadata;
};

type MaestroCommand = string | Record<string, unknown>;

export function parseMaestroReplayFlow(script: string): MaestroReplayFlow {
  const documents = parseAllDocuments(script);
  for (const document of documents) {
    if (document.errors.length > 0) {
      const message = document.errors[0]?.message ?? 'Invalid Maestro YAML flow.';
      throw new AppError('INVALID_ARGS', `Invalid Maestro YAML flow: ${message}`);
    }
  }

  const values = documents
    .map((document) => document.toJSON() as unknown)
    .filter((value) => value !== null);
  const { config, commands } = splitMaestroDocuments(values);
  const actions: SessionAction[] = [];
  const actionLines: number[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const converted = convertMaestroCommand(command, config);
    actions.push(...converted);
    converted.forEach(() => actionLines.push(index + 1));
  }

  return {
    actions,
    actionLines,
    metadata: {
      env: config.env,
    },
  };
}

function splitMaestroDocuments(values: unknown[]): {
  config: MaestroFlowConfig;
  commands: MaestroCommand[];
} {
  if (values.length === 0) {
    throw new AppError('INVALID_ARGS', 'Maestro flow is empty.');
  }

  if (Array.isArray(values[0])) {
    return { config: {}, commands: normalizeCommandList(values[0]) };
  }

  const config = normalizeConfig(values[0]);
  const commandDocument = values[1];
  if (!Array.isArray(commandDocument)) {
    throw new AppError(
      'INVALID_ARGS',
      'Maestro flow must contain a command list after the YAML document separator.',
    );
  }
  return { config, commands: normalizeCommandList(commandDocument) };
}

function normalizeConfig(value: unknown): MaestroFlowConfig {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'Maestro flow config must be a YAML map.');
  }
  const config: MaestroFlowConfig = {};
  if (typeof value.appId === 'string' && value.appId.length > 0) {
    config.appId = value.appId;
  }
  if (isPlainRecord(value.env)) {
    config.env = {};
    for (const [key, raw] of Object.entries(value.env)) {
      if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
        config.env[key] = String(raw);
      }
    }
  }
  return config;
}

function normalizeCommandList(value: unknown[]): MaestroCommand[] {
  return value.map((entry, index) => {
    if (typeof entry === 'string') return entry;
    if (isPlainRecord(entry)) return entry;
    throw new AppError(
      'INVALID_ARGS',
      `Unsupported Maestro command at index ${index + 1}: expected a scalar or one-key map.`,
    );
  });
}

// fallow-ignore-next-line complexity
function convertMaestroCommand(
  command: MaestroCommand,
  config: MaestroFlowConfig,
): SessionAction[] {
  if (typeof command === 'string') {
    if (command === 'launchApp') return [action('open', [requireAppId(config, 'launchApp')])];
    if (command === 'hideKeyboard') return [action('keyboard', ['dismiss'])];
    if (command === 'back') return [action('back')];
    if (command === 'waitForAnimationToEnd') return [action('wait', ['250'])];
    return unsupportedCommand(command);
  }

  const entries = Object.entries(command);
  if (entries.length !== 1) {
    throw new AppError('INVALID_ARGS', 'Maestro command maps must contain exactly one command.');
  }

  const [name, value] = entries[0] as [string, unknown];
  switch (name) {
    case 'launchApp':
      return [convertLaunchApp(value, config)];
    case 'tapOn':
      return [convertTapOn(value)];
    case 'inputText':
      return [action('type', [requireStringValue(name, value)])];
    case 'openLink':
      return [action('open', [requireStringValue(name, value)])];
    case 'assertVisible': {
      const selector = maestroSelector(value, name);
      return [action('wait', [selector, '5000'])];
    }
    case 'extendedWaitUntil':
      return convertExtendedWaitUntil(value);
    case 'takeScreenshot':
      return [action('screenshot', [requireStringValue(name, value)])];
    case 'hideKeyboard':
      return [action('keyboard', ['dismiss'])];
    case 'pressKey':
      return [convertPressKey(value)];
    case 'back':
      return [action('back')];
    case 'waitForAnimationToEnd':
      return [action('wait', [String(readTimeoutMs(value, 250))])];
    default:
      return unsupportedCommand(name);
  }
}

function convertLaunchApp(value: unknown, config: MaestroFlowConfig): SessionAction {
  if (value === null || value === undefined)
    return action('open', [requireAppId(config, 'launchApp')]);
  if (typeof value === 'string') return action('open', [value]);
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'launchApp expects a string or map.');
  }
  const appId = typeof value.appId === 'string' ? value.appId : requireAppId(config, 'launchApp');
  return action('open', [appId], { relaunch: value.stopApp === true });
}

function convertTapOn(value: unknown): SessionAction {
  if (isPlainRecord(value) && typeof value.point === 'string') {
    const point = parsePoint(value.point);
    return action('click', [String(point.x), String(point.y)], tapFlags(value));
  }
  return action('click', [maestroSelector(value, 'tapOn')], tapFlags(value));
}

function convertExtendedWaitUntil(value: unknown): SessionAction[] {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'extendedWaitUntil expects a map.');
  }
  const target = value.visible ?? value.notVisible;
  if (target === undefined) {
    throw new AppError(
      'INVALID_ARGS',
      'Prototype supports only extendedWaitUntil.visible/notVisible.',
    );
  }
  const selector = maestroSelector(target, 'extendedWaitUntil');
  const timeoutMs = String(readTimeoutMs(value, 30000));
  if (value.notVisible !== undefined) {
    return [action('wait', [timeoutMs]), action('is', ['hidden', selector])];
  }
  return [action('wait', [selector, timeoutMs])];
}

function convertPressKey(value: unknown): SessionAction {
  const key = requireStringValue('pressKey', value).toLowerCase();
  if (key === 'back') return action('back');
  if (key === 'enter' || key === 'return') return action('press', ['return']);
  if (key === 'home') return action('home');
  throw new AppError('INVALID_ARGS', `Prototype does not support Maestro pressKey "${key}".`);
}

function maestroSelector(value: unknown, command: string): string {
  if (typeof value === 'string') return visibleTextSelector(value);
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', `${command} expects a string or selector map.`);
  }

  const terms: string[] = [];
  if (typeof value.id === 'string') terms.push(selectorTerm('id', value.id));
  if (typeof value.text === 'string') terms.push(selectorTerm('label', value.text));
  if (typeof value.enabled === 'boolean')
    terms.push(selectorTerm('enabled', String(value.enabled)));
  if (terms.length === 0) {
    throw new AppError(
      'INVALID_ARGS',
      `${command} selector map must include one of id, text, or enabled.`,
    );
  }
  return terms.join(' ');
}

function visibleTextSelector(value: string): string {
  return [
    selectorTerm('label', value),
    selectorTerm('text', value),
    selectorTerm('id', value),
  ].join(' || ');
}

function selectorTerm(key: string, value: string): string {
  return `${key}=${JSON.stringify(value)}`;
}

function tapFlags(value: unknown): SessionAction['flags'] | undefined {
  if (!isPlainRecord(value)) return undefined;
  const flags: SessionAction['flags'] = {};
  if (typeof value.repeat === 'number' && Number.isInteger(value.repeat) && value.repeat > 1) {
    flags.count = value.repeat;
  }
  if (typeof value.delay === 'number' && Number.isInteger(value.delay) && value.delay >= 0) {
    flags.intervalMs = value.delay;
  }
  return Object.keys(flags).length > 0 ? flags : undefined;
}

function parsePoint(value: string): { x: number; y: number } {
  const match = value.match(/^(\d+),(\d+)$/);
  if (!match) {
    throw new AppError(
      'INVALID_ARGS',
      'Prototype supports only absolute Maestro point selectors like "100,200".',
    );
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

function readTimeoutMs(value: unknown, fallback: number): number {
  if (isPlainRecord(value) && typeof value.timeout === 'number' && Number.isFinite(value.timeout)) {
    return Math.max(0, Math.floor(value.timeout));
  }
  return fallback;
}

function requireAppId(config: MaestroFlowConfig, command: string): string {
  if (config.appId) return config.appId;
  throw new AppError('INVALID_ARGS', `${command} requires appId in the Maestro flow config.`);
}

function requireStringValue(command: string, value: unknown): string {
  if (typeof value === 'string') return value;
  throw new AppError('INVALID_ARGS', `${command} expects a string value.`);
}

function unsupportedCommand(command: string): never {
  throw new AppError(
    'INVALID_ARGS',
    `Prototype does not support Maestro command "${command}" yet.`,
  );
}

function action(
  command: string,
  positionals: string[] = [],
  flags?: SessionAction['flags'],
): SessionAction {
  return {
    ts: Date.now(),
    command,
    positionals,
    flags: flags ?? {},
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
