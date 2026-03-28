import { printJson } from '../../utils/output.ts';
import { AppError } from '../../utils/errors.ts';
import {
  serializeDeployResult,
  serializeInstallFromSourceResult,
} from '../../cli-serializers.ts';
import { readCommandMessage } from '../../utils/success-text.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient, AppDeployResult } from '../../client.ts';
import { buildSelectionOptions } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const installCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = await runDeployCommand('install', positionals, flags, client);
  const data = serializeDeployResult(result);
  if (flags.json) printJson({ success: true, data });
  else writeHumanMessage(data);
  return true;
};

export const reinstallCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = await runDeployCommand('reinstall', positionals, flags, client);
  const data = serializeDeployResult(result);
  if (flags.json) printJson({ success: true, data });
  else writeHumanMessage(data);
  return true;
};

export const installFromSourceCommand: ClientCommandHandler = async ({
  positionals,
  flags,
  client,
}) => {
  const result = await runInstallFromSourceCommand(positionals, flags, client);
  const data = serializeInstallFromSourceResult(result);
  if (flags.json) printJson({ success: true, data });
  else writeHumanMessage(data);
  return true;
};

function writeHumanMessage(data: Record<string, unknown>): void {
  const message = readCommandMessage(data);
  if (message) process.stdout.write(`${message}\n`);
}

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
  const url = positionals[0]?.trim();
  if (!url) {
    throw new AppError('INVALID_ARGS', 'install-from-source requires: install-from-source <url>');
  }
  if (positionals.length > 1) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source accepts exactly one positional argument: <url>',
    );
  }
  return await client.apps.installFromSource({
    ...buildSelectionOptions(flags),
    retainPaths: flags.retainPaths,
    retentionMs: flags.retentionMs,
    source: {
      kind: 'url',
      url,
      headers: parseInstallSourceHeaders(flags.header),
    },
  });
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
