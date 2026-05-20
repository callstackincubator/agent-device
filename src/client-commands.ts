import { PUBLIC_COMMANDS, type PublicCommandName } from './command-catalog.ts';
import { waitCommandCodec } from './command-codecs.ts';
import type { AgentDeviceCommandClient, InternalRequestOptions } from './client-types.ts';

export type PreparedClientCommand = {
  command: PublicCommandName;
  positionals: string[];
  options: InternalRequestOptions;
};

type ExecutePreparedCommand = <T>(prepared: PreparedClientCommand) => Promise<T>;
type CommandOptions<T extends keyof AgentDeviceCommandClient> = NonNullable<
  Parameters<AgentDeviceCommandClient[T]>[0]
>;
type CommandResult<T extends keyof AgentDeviceCommandClient> = Awaited<
  ReturnType<AgentDeviceCommandClient[T]>
>;

export function createAgentDeviceCommandClient(
  executePreparedCommand: ExecutePreparedCommand,
): AgentDeviceCommandClient {
  const run = async <T extends keyof AgentDeviceCommandClient>(
    prepared: PreparedClientCommand,
  ): Promise<CommandResult<T>> => await executePreparedCommand<CommandResult<T>>(prepared);

  return {
    wait: async (options) => await run<'wait'>(prepareWaitCommand(options)),
    alert: async (options = {}) => await run<'alert'>(prepareAlertCommand(options)),
    appState: async (options = {}) =>
      await run<'appState'>({
        command: PUBLIC_COMMANDS.appState,
        positionals: [],
        options,
      }),
    back: async (options = {}) =>
      await run<'back'>({
        command: PUBLIC_COMMANDS.back,
        positionals: [],
        options: {
          ...options,
          backMode: options.mode,
        },
      }),
    home: async (options = {}) =>
      await run<'home'>({
        command: PUBLIC_COMMANDS.home,
        positionals: [],
        options,
      }),
    rotate: async (options) =>
      await run<'rotate'>({
        command: PUBLIC_COMMANDS.rotate,
        positionals: [options.orientation],
        options,
      }),
    appSwitcher: async (options = {}) =>
      await run<'appSwitcher'>({
        command: PUBLIC_COMMANDS.appSwitcher,
        positionals: [],
        options,
      }),
    keyboard: async (options = {}) =>
      await run<'keyboard'>({
        command: PUBLIC_COMMANDS.keyboard,
        positionals: options.action ? [options.action] : [],
        options,
      }),
    clipboard: async (options) => await run<'clipboard'>(prepareClipboardCommand(options)),
    reactNative: async (options) =>
      await run<'reactNative'>({
        command: PUBLIC_COMMANDS.reactNative,
        positionals: [options.action],
        options,
      }),
  };
}

function prepareWaitCommand(options: CommandOptions<'wait'>): PreparedClientCommand {
  return {
    command: PUBLIC_COMMANDS.wait,
    positionals: waitCommandCodec.encode(options),
    options,
  };
}

function prepareAlertCommand(options: CommandOptions<'alert'>): PreparedClientCommand {
  const action = options.action ?? 'get';
  return {
    command: PUBLIC_COMMANDS.alert,
    positionals: [action, ...(options.timeoutMs !== undefined ? [String(options.timeoutMs)] : [])],
    options,
  };
}

function prepareClipboardCommand(options: CommandOptions<'clipboard'>): PreparedClientCommand {
  if (options.action === 'read') {
    return { command: PUBLIC_COMMANDS.clipboard, positionals: ['read'], options };
  }
  return {
    command: PUBLIC_COMMANDS.clipboard,
    positionals: ['write', options.text],
    options,
  };
}
