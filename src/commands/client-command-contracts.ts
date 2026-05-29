import type {
  AppCloseOptions,
  ClipboardCommandOptions,
  MetroPrepareOptions,
  MetroPrepareResult,
  MetroReloadOptions,
  MetroReloadResult,
  RecordOptions,
  SettingsUpdateOptions,
  WaitCommandOptions,
} from '../client-types.ts';
import { defineExecutableCommand } from './command-contract.ts';
import { optionalEnum } from './command-input.ts';
import { clientCommandMetadata } from './client-command-metadata.ts';

const WAIT_KIND_VALUES = ['duration', 'text', 'ref', 'selector'] as const;

type ClientCommandMetadata = (typeof clientCommandMetadata)[number];
type ClientCommandName = ClientCommandMetadata['name'];
type MetroInput = { action: 'prepare' | 'reload' } & MetroPrepareOptions & MetroReloadOptions;

export const clientCommandDefinitions = [
  defineExecutableCommand(metadata('devices'), (client, input) => client.devices.list(input)),
  defineExecutableCommand(metadata('boot'), (client, input) => client.devices.boot(input)),
  defineExecutableCommand(metadata('apps'), (client, input) => client.apps.list(input)),
  defineExecutableCommand(metadata('session'), async (client, { action: _action, ...input }) => ({
    sessions: await client.sessions.list(input),
  })),
  defineExecutableCommand(metadata('open'), (client, input) => client.apps.open(input)),
  defineExecutableCommand(metadata('close'), (client, input) =>
    input.app ? client.apps.close(input) : client.sessions.close(withoutApp(input)),
  ),
  defineExecutableCommand(metadata('install'), (client, input) => client.apps.install(input)),
  defineExecutableCommand(metadata('reinstall'), (client, input) => client.apps.reinstall(input)),
  defineExecutableCommand(metadata('install-from-source'), (client, input) =>
    client.apps.installFromSource(input),
  ),
  defineExecutableCommand(metadata('push'), (client, input) => client.apps.push(input)),
  defineExecutableCommand(metadata('trigger-app-event'), (client, input) =>
    client.apps.triggerEvent(input),
  ),
  defineExecutableCommand(metadata('snapshot'), (client, input) => client.capture.snapshot(input)),
  defineExecutableCommand(metadata('screenshot'), (client, input) =>
    client.capture.screenshot(input),
  ),
  defineExecutableCommand(metadata('diff'), (client, input) => client.capture.diff(input)),
  defineExecutableCommand(metadata('wait'), (client, input) =>
    client.command.wait(waitInputToOptions(input)),
  ),
  defineExecutableCommand(metadata('alert'), (client, input) => client.command.alert(input)),
  defineExecutableCommand(metadata('appstate'), (client, input) => client.command.appState(input)),
  defineExecutableCommand(metadata('back'), (client, input) => client.command.back(input)),
  defineExecutableCommand(metadata('home'), (client, input) => client.command.home(input)),
  defineExecutableCommand(metadata('rotate'), (client, input) => client.command.rotate(input)),
  defineExecutableCommand(metadata('app-switcher'), (client, input) =>
    client.command.appSwitcher(input),
  ),
  defineExecutableCommand(metadata('keyboard'), (client, input) => client.command.keyboard(input)),
  defineExecutableCommand(metadata('clipboard'), (client, input) =>
    client.command.clipboard(input as ClipboardCommandOptions),
  ),
  defineExecutableCommand(metadata('react-native'), (client, input) =>
    client.command.reactNative(input),
  ),
  defineExecutableCommand(metadata('replay'), (client, input) => client.replay.run(input)),
  defineExecutableCommand(metadata('test'), (client, input) => client.replay.test(input)),
  defineExecutableCommand(metadata('perf'), (client, input) => client.observability.perf(input)),
  defineExecutableCommand(metadata('logs'), (client, input) => client.observability.logs(input)),
  defineExecutableCommand(metadata('network'), (client, input) =>
    client.observability.network(input),
  ),
  defineExecutableCommand(metadata('record'), (client, input) =>
    client.recording.record(input as RecordOptions),
  ),
  defineExecutableCommand(metadata('trace'), (client, input) => client.recording.trace(input)),
  defineExecutableCommand(metadata('settings'), (client, input) =>
    client.settings.update(input as SettingsUpdateOptions),
  ),
  defineExecutableCommand(
    metadata('metro'),
    async (client, input): Promise<MetroPrepareResult | MetroReloadResult> =>
      input.action === 'prepare'
        ? await client.metro.prepare(toMetroPrepareOptions(input))
        : await client.metro.reload(toMetroReloadOptions(input)),
  ),
] as const;

function metadata<TName extends ClientCommandName>(
  name: TName,
): Extract<ClientCommandMetadata, { name: TName }> {
  const definition = clientCommandMetadata.find((item) => item.name === name);
  if (!definition) throw new Error(`Missing client command metadata for ${name}`);
  return definition as Extract<ClientCommandMetadata, { name: TName }>;
}

function withoutApp(input: AppCloseOptions & { shutdown?: boolean }): { shutdown?: boolean } {
  const { app: _app, ...rest } = input;
  return rest;
}

function toMetroPrepareOptions(input: MetroInput): MetroPrepareOptions {
  return {
    projectRoot: input.projectRoot,
    kind: input.kind,
    publicBaseUrl: input.publicBaseUrl,
    proxyBaseUrl: input.proxyBaseUrl,
    bearerToken: input.bearerToken,
    bridgeScope: input.bridgeScope ?? metroBridgeScopeFromInput(input),
    port: input.port,
    listenHost: input.listenHost,
    statusHost: input.statusHost,
    startupTimeoutMs: input.startupTimeoutMs,
    probeTimeoutMs: input.probeTimeoutMs,
    reuseExisting: input.reuseExisting,
    installDependenciesIfNeeded: input.installDependenciesIfNeeded,
    runtimeFilePath: input.runtimeFilePath,
  };
}

function metroBridgeScopeFromInput(
  input: MetroInput & {
    tenant?: string;
    runId?: string;
    leaseId?: string;
  },
): MetroPrepareOptions['bridgeScope'] {
  return input.tenant && input.runId && input.leaseId
    ? { tenantId: input.tenant, runId: input.runId, leaseId: input.leaseId }
    : undefined;
}

function toMetroReloadOptions(input: MetroInput): MetroReloadOptions {
  return {
    metroHost: input.metroHost,
    metroPort: input.metroPort,
    bundleUrl: input.bundleUrl,
    timeoutMs: input.timeoutMs,
  };
}

function waitInputToOptions(input: Record<string, unknown>): WaitCommandOptions {
  optionalEnum(input, 'kind', WAIT_KIND_VALUES);
  const options = { ...input };
  delete options.kind;
  return options as WaitCommandOptions & { kind?: never };
}
