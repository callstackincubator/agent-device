import { INTERNAL_COMMANDS, PUBLIC_COMMANDS } from '../../command-catalog.ts';
import type { AppPushOptions, AppTriggerEventOptions } from '../../client-types.ts';
import type { CliFlags } from '../../utils/cli-flags.ts';
import { AppError } from '../../utils/errors.ts';
import { parseGitHubActionsArtifactInstallSourceSpec } from '../../utils/install-source-config.ts';
import { assertResolvedAppsFilter } from '../app-inventory-contract.ts';
import {
  commonInputFromFlags,
  direct,
  optionalString,
  readJsonObject,
  request,
  requiredDaemonString,
  requiredString,
} from './common.ts';
import type { CliReader, DaemonWriter, CommandInput } from './types.ts';

export const appCliReaders = {
  devices: (_positionals, flags) => commonInputFromFlags(flags),
  apps: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    appsFilter: assertResolvedAppsFilter(flags.appsFilter),
  }),
  session: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: readSessionAction(positionals[0]),
  }),
  boot: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    headless: flags.headless,
  }),
  prepare: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    action: requiredString(positionals[0], 'prepare requires subcommand'),
    timeoutMs: flags.timeoutMs,
  }),
  open: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    app: positionals[0],
    url: positionals[1],
    surface: flags.surface,
    activity: flags.activity,
    launchConsole: flags.launchConsole,
    launchArgs: flags.launchArgs,
    relaunch: flags.relaunch,
    saveScript: flags.saveScript,
    noRecord: flags.noRecord,
  }),
  close: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    app: positionals[0],
    shutdown: flags.shutdown,
    saveScript: flags.saveScript,
  }),
  install: installInputFromCli,
  reinstall: installInputFromCli,
  'install-from-source': (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    source: resolveInstallSource(positionals, flags),
    retainPaths: flags.retainPaths,
    retentionMs: flags.retentionMs,
  }),
  push: (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    app: requiredString(positionals[0], 'push requires bundleOrPackage'),
    payload: requiredString(positionals[1], 'push requires payloadOrJson'),
  }),
  'trigger-app-event': (positionals, flags) => ({
    ...commonInputFromFlags(flags),
    event: requiredString(positionals[0], 'trigger-app-event requires event'),
    payload: positionals[1]
      ? readJsonObject(positionals[1], 'trigger-app-event payload')
      : undefined,
  }),
} satisfies Record<string, CliReader>;

export const appDaemonWriters = {
  devices: direct(PUBLIC_COMMANDS.devices),
  boot: direct(PUBLIC_COMMANDS.boot),
  prepare: direct(PUBLIC_COMMANDS.prepare, (input) => [
    requiredDaemonString(input.action, 'prepare requires subcommand'),
  ]),
  apps: direct(PUBLIC_COMMANDS.apps),
  open: direct(PUBLIC_COMMANDS.open, openPositionals),
  close: direct(PUBLIC_COMMANDS.close, (input) => optionalString(input.app)),
  install: direct(PUBLIC_COMMANDS.install, (input) => requiredPair(input.app, input.appPath)),
  reinstall: direct(PUBLIC_COMMANDS.reinstall, (input) => requiredPair(input.app, input.appPath)),
  'install-from-source': (input) =>
    request(INTERNAL_COMMANDS.installSource, [], {
      ...input,
      installSource: input.source,
      retainMaterializedPaths: input.retainPaths,
      materializedPathRetentionMs: input.retentionMs,
    }),
  push: direct(PUBLIC_COMMANDS.push, (input) => pushPositionals(input as AppPushOptions)),
  'trigger-app-event': direct(PUBLIC_COMMANDS.triggerAppEvent, (input) =>
    triggerEventPositionals(input as AppTriggerEventOptions),
  ),
} satisfies Record<string, DaemonWriter>;

function installInputFromCli(
  positionals: string[],
  flags: CliFlags,
  command = 'install',
): Record<string, unknown> {
  return {
    ...commonInputFromFlags(flags),
    app: requiredString(positionals[0], `${command} requires app`),
    appPath: requiredString(positionals[1], `${command} requires path`),
  };
}

function readSessionAction(value: string | undefined): 'list' {
  const action = value ?? 'list';
  if (action === 'list') return action;
  throw new AppError('INVALID_ARGS', 'session only supports list');
}

function openPositionals(input: CommandInput): string[] {
  if (!input.app) return [];
  return input.url ? [input.app, input.url] : [input.app];
}

function requiredPair(first: unknown, second: unknown): string[] {
  return [
    requiredDaemonString(first, 'missing first positional'),
    requiredDaemonString(second, 'missing second positional'),
  ];
}

function pushPositionals(input: AppPushOptions): string[] {
  return [
    input.app,
    typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload),
  ];
}

function triggerEventPositionals(input: AppTriggerEventOptions): string[] {
  return [input.event, ...(input.payload ? [JSON.stringify(input.payload)] : [])];
}

// fallow-ignore-next-line complexity
function resolveInstallSource(positionals: string[], flags: CliFlags) {
  const url = positionals[0]?.trim();
  if (positionals.length > 1) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source accepts either one <url> positional or --github-actions-artifact',
    );
  }
  const githubArtifactSource = flags.githubActionsArtifact
    ? parseGitHubActionsArtifactInstallSourceSpec(flags.githubActionsArtifact)
    : undefined;
  const configuredSource = flags.installSource;
  const sourceCount = (url ? 1 : 0) + (githubArtifactSource ? 1 : 0) + (configuredSource ? 1 : 0);
  if (sourceCount !== 1) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source requires exactly one source: <url>, --github-actions-artifact, or config installSource',
    );
  }
  if (!url && flags.header && flags.header.length > 0) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source --header is only supported for URL sources',
    );
  }
  if (githubArtifactSource) return githubArtifactSource;
  if (configuredSource) return configuredSource;
  return {
    kind: 'url' as const,
    url: url!,
    headers: parseInstallSourceHeaders(flags.header),
  };
}

function parseInstallSourceHeaders(
  headerFlags: CliFlags['header'],
): Record<string, string> | undefined {
  if (!headerFlags || headerFlags.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const rawHeader of headerFlags) {
    const separator = rawHeader.indexOf(':');
    if (separator <= 0) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid --header value "${rawHeader}". Expected "name:value".`,
      );
    }
    const name = rawHeader.slice(0, separator).trim();
    const value = rawHeader.slice(separator + 1).trim();
    if (!name) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid --header value "${rawHeader}". Header name cannot be empty.`,
      );
    }
    headers[name] = value;
  }
  return headers;
}
