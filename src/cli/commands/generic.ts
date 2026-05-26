import {
  serializeCloseResult,
  serializeDeployResult,
  serializeDevice,
  serializeInstallFromSourceResult,
  serializeOpenResult,
  serializeSessionListEntry,
  serializeSnapshotResult,
} from '../../client-shared.ts';
import type {
  AgentDeviceClient,
  AgentDeviceDevice,
  AgentDeviceSession,
  AppCloseResult,
  AppDeployResult,
  AppInstallFromSourceResult,
  AppOpenResult,
  CaptureSnapshotResult,
  CommandRequestResult,
  SessionCloseResult,
} from '../../client.ts';
import { announceReplayTestRun } from '../../cli-test.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import {
  listSemanticCommandNames,
  type SemanticCliCommand,
} from '../../commands/semantic-command-surface.ts';
import { assertResolvedAppsFilter } from '../../commands/app-inventory-contract.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { AppError } from '../../utils/errors.ts';
import { formatSnapshotText } from '../../utils/output.ts';
import { writeCommandCliOutput } from './output.ts';
import { writeCommandMessage, writeCommandOutput } from './shared.ts';
import type { PublicCommandName } from '../../command-catalog.ts';
import type { ClientCommandHandler } from './router-types.ts';

type GenericClientCommandRunner = (params: {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
}) => Promise<CommandRequestResult>;

const formattedSemanticCommandHandlers = {
  devices: createFormattedSemanticHandler('devices', {
    write: ({ flags, result }) => {
      const devices = result as unknown as AgentDeviceDevice[];
      const data = { devices: devices.map(serializeDevice) };
      writeCommandOutput(flags, data, () => devices.map(formatDeviceLine).join('\n'));
    },
  }),
  apps: createFormattedSemanticHandler('apps', {
    write: ({ flags, result }) => {
      const appsFilter = assertResolvedAppsFilter(flags.appsFilter);
      const apps = result as unknown as string[];
      const data = { apps };
      writeCommandOutput(flags, data, () => {
        if (!flags.json) {
          process.stderr.write(
            appsFilter === 'all'
              ? 'Showing all apps, including system apps.\n'
              : 'Showing user-installed apps. Use --all to include system apps.\n',
          );
        }
        if (apps.length > 0) return apps.join('\n');
        return appsFilter === 'all' ? 'No apps found.' : 'No user-installed apps found.';
      });
    },
  }),
  session: createFormattedSemanticHandler('session', {
    beforeRun: ({ positionals }) => {
      const subcommand = positionals[0] ?? 'list';
      if (subcommand !== 'list') {
        throw new AppError('INVALID_ARGS', 'session only supports list');
      }
    },
    write: ({ flags, result }) => {
      const sessions = (result as { sessions: AgentDeviceSession[] }).sessions;
      const data = { sessions: sessions.map(serializeSessionListEntry) };
      writeCommandOutput(flags, data, () => JSON.stringify(data, null, 2));
    },
  }),
  open: createFormattedSemanticHandler('open', {
    write: ({ flags, result }) => {
      writeCommandMessage(flags, serializeOpenResult(result as AppOpenResult));
    },
  }),
  close: createFormattedSemanticHandler('close', {
    write: ({ flags, result }) => {
      writeCommandMessage(
        flags,
        serializeCloseResult(result as AppCloseResult | SessionCloseResult),
      );
    },
  }),
  install: createFormattedSemanticHandler('install', {
    write: ({ flags, result }) => {
      writeCommandMessage(flags, serializeDeployResult(result as AppDeployResult));
    },
  }),
  reinstall: createFormattedSemanticHandler('reinstall', {
    write: ({ flags, result }) => {
      writeCommandMessage(flags, serializeDeployResult(result as AppDeployResult));
    },
  }),
  'install-from-source': createFormattedSemanticHandler('install-from-source', {
    write: ({ flags, result }) => {
      writeCommandMessage(
        flags,
        serializeInstallFromSourceResult(result as AppInstallFromSourceResult),
      );
    },
  }),
  snapshot: createFormattedSemanticHandler('snapshot', {
    positionals: () => [],
    write: ({ flags, result }) => {
      const data = serializeSnapshotResult(result as CaptureSnapshotResult);
      // Programmatic SDK callers can see `unchanged`; CLI --json hides it for schema compatibility.
      const outputData = flags.json ? withoutUnchanged(data) : data;
      writeCommandOutput(flags, outputData, () =>
        formatSnapshotText(outputData, {
          raw: flags.snapshotRaw,
          flatten: flags.snapshotInteractiveOnly,
        }),
      );
    },
  }),
  metro: createFormattedSemanticHandler('metro', {
    write: ({ positionals, flags, result }) => {
      const action = (positionals[0] ?? '').toLowerCase();
      writeCommandOutput(flags, result, () =>
        action === 'reload'
          ? `Reloaded React Native apps via ${(result as { reloadUrl?: unknown }).reloadUrl}`
          : JSON.stringify(result, null, 2),
      );
    },
  }),
} satisfies Partial<Record<SemanticCliCommand, ClientCommandHandler>>;

export const dedicatedSemanticCommandHandlers = formattedSemanticCommandHandlers;

const clientMethodCommandNames = commandNameSet([
  'wait',
  'alert',
  'appstate',
  'back',
  'home',
  'rotate',
  'app-switcher',
  'keyboard',
  'clipboard',
] as const satisfies readonly SemanticCliCommand[]);

const semanticGenericCommands = listSemanticCommandNames().filter(isGenericSemanticCliCommand);

const genericClientCommandRunners = Object.fromEntries(
  semanticGenericCommands.map((command) => [
    command,
    async ({ client, positionals, flags }) => {
      if (command === 'test') {
        announceReplayTestRun({ json: flags.json });
      }
      return await runSemanticCliCommand({ client, command, positionals, flags });
    },
  ]),
) as Record<(typeof semanticGenericCommands)[number], GenericClientCommandRunner>;

export const genericClientCommandHandlers = Object.fromEntries(
  Object.entries(genericClientCommandRunners).map(([command, run]) => [
    command,
    createGenericClientCommandHandler(
      command as PublicCommandName,
      run as GenericClientCommandRunner,
    ),
  ]),
) as { [TCommand in keyof typeof genericClientCommandRunners]: ClientCommandHandler };

function createGenericClientCommandHandler(
  command: PublicCommandName,
  run: GenericClientCommandRunner,
): ClientCommandHandler {
  return async ({ positionals, flags, client }) => {
    const data = await run({ client, positionals, flags });
    const exitCode = writeCommandCliOutput(command, positionals, flags, data);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return true;
  };
}

function createFormattedSemanticHandler(
  command: SemanticCliCommand,
  options: {
    positionals?: (positionals: string[]) => string[];
    beforeRun?: (params: { positionals: string[]; flags: CliFlags }) => void;
    write: (params: {
      positionals: string[];
      flags: CliFlags;
      result: Awaited<ReturnType<typeof runSemanticCliCommand>>;
    }) => void;
  },
): ClientCommandHandler {
  return async ({ positionals, flags, client }) => {
    options.beforeRun?.({ positionals, flags });
    const semanticPositionals = options.positionals?.(positionals) ?? positionals;
    const result = await runSemanticCliCommand({
      client,
      command,
      positionals: semanticPositionals,
      flags,
    });
    options.write({ positionals, flags, result });
    return true;
  };
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

function isGenericSemanticCliCommand(command: SemanticCliCommand): boolean {
  return (
    !(command in formattedSemanticCommandHandlers) &&
    !clientMethodCommandNames.has(command) &&
    command !== 'screenshot' &&
    command !== 'diff'
  );
}

function commandNameSet<const TName extends string>(names: readonly TName[]): ReadonlySet<string> {
  return new Set(names);
}
