import { AppError } from './utils/errors.ts';
import { tryParseSelectorChain } from './daemon/selectors.ts';
import { CLIENT_COMMANDS } from './client-command-registry.ts';
import type { AgentDeviceCommandClient, InternalRequestOptions } from './client-types.ts';

export type PreparedClientCommand = {
  command: string;
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
        command: CLIENT_COMMANDS.appState,
        positionals: [],
        options,
      }),
    back: async (options = {}) =>
      await run<'back'>({
        command: CLIENT_COMMANDS.back,
        positionals: [],
        options: {
          ...options,
          backMode: options.mode,
        },
      }),
    home: async (options = {}) =>
      await run<'home'>({
        command: CLIENT_COMMANDS.home,
        positionals: [],
        options,
      }),
    rotate: async (options) =>
      await run<'rotate'>({
        command: CLIENT_COMMANDS.rotate,
        positionals: [options.orientation],
        options,
      }),
    appSwitcher: async (options = {}) =>
      await run<'appSwitcher'>({
        command: CLIENT_COMMANDS.appSwitcher,
        positionals: [],
        options,
      }),
    keyboard: async (options = {}) =>
      await run<'keyboard'>({
        command: CLIENT_COMMANDS.keyboard,
        positionals: options.action ? [options.action] : [],
        options,
      }),
    clipboard: async (options) => await run<'clipboard'>(prepareClipboardCommand(options)),
  };
}

function prepareWaitCommand(options: CommandOptions<'wait'>): PreparedClientCommand {
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
  if (options.durationMs !== undefined) {
    return { command: CLIENT_COMMANDS.wait, positionals: [String(options.durationMs)], options };
  }

  const timeout = options.timeoutMs !== undefined ? [String(options.timeoutMs)] : [];
  if (options.text !== undefined) {
    return {
      command: CLIENT_COMMANDS.wait,
      positionals: ['text', options.text, ...timeout],
      options,
    };
  }
  if (options.ref !== undefined) {
    return {
      command: CLIENT_COMMANDS.wait,
      positionals: [options.ref, ...timeout],
      options,
    };
  }
  const selector = options.selector!;
  assertValidSelector(selector);
  return {
    command: CLIENT_COMMANDS.wait,
    positionals: [selector, ...timeout],
    options,
  };
}

function assertValidSelector(selector: string): void {
  if (tryParseSelectorChain(selector)) return;
  throw new AppError('INVALID_ARGS', `Invalid wait selector: ${selector}`);
}

function prepareAlertCommand(options: CommandOptions<'alert'>): PreparedClientCommand {
  const action = options.action ?? 'get';
  return {
    command: CLIENT_COMMANDS.alert,
    positionals: [action, ...(options.timeoutMs !== undefined ? [String(options.timeoutMs)] : [])],
    options,
  };
}

function prepareClipboardCommand(options: CommandOptions<'clipboard'>): PreparedClientCommand {
  if (options.action === 'read') {
    return { command: CLIENT_COMMANDS.clipboard, positionals: ['read'], options };
  }
  return {
    command: CLIENT_COMMANDS.clipboard,
    positionals: ['write', options.text],
    options,
  };
}
