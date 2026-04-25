import { AppError } from '../../utils/errors.ts';
import { serializeDeployResult, serializeInstallFromSourceResult } from '../../client-shared.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient, AppDeployResult } from '../../client.ts';
import { buildSelectionOptions, writeCommandMessage } from './shared.ts';
import { parseGitHubActionsArtifactInstallSourceSpec } from '../../utils/install-source-config.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const installCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = await runDeployCommand('install', positionals, flags, client);
  const data = serializeDeployResult(result);
  writeCommandMessage(flags, data);
  return true;
};

export const reinstallCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = await runDeployCommand('reinstall', positionals, flags, client);
  const data = serializeDeployResult(result);
  writeCommandMessage(flags, data);
  return true;
};

export const installFromSourceCommand: ClientCommandHandler = async ({
  positionals,
  flags,
  client,
}) => {
  const result = await runInstallFromSourceCommand(positionals, flags, client);
  const data = serializeInstallFromSourceResult(result);
  writeCommandMessage(flags, data);
  return true;
};

async function runDeployCommand(
  command: 'install' | 'reinstall',
  positionals: string[],
  flags: CliFlags,
  client: AgentDeviceClient,
): Promise<AppDeployResult> {
  const app = positionals[0];
  const appPath = positionals[1];
  if (!app || !appPath) {
    throw new AppError(
      'INVALID_ARGS',
      `${command} requires: ${command} <app> <path-to-app-binary>`,
    );
  }
  const options = {
    app,
    appPath,
    ...buildSelectionOptions(flags),
  };
  return command === 'install'
    ? await client.apps.install(options)
    : await client.apps.reinstall(options);
}

async function runInstallFromSourceCommand(
  positionals: string[],
  flags: CliFlags,
  client: AgentDeviceClient,
) {
  const source = resolveInstallSource(positionals, flags);
  if (source.kind !== 'url' && flags.header && flags.header.length > 0) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source --header is only supported for URL sources',
    );
  }
  return await client.apps.installFromSource({
    ...buildSelectionOptions(flags),
    retainPaths: flags.retainPaths,
    retentionMs: flags.retentionMs,
    source,
  });
}

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
