import type {
  AppStateCommandResult,
  ClipboardCommandResult,
  KeyboardCommandResult,
} from '../../client.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { readCommandMessage } from '../../utils/success-text.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import { writeCommandMessage, writeCommandOutput } from './shared.ts';
import type { ClientCommandHandlerMap } from './router-types.ts';

export const clientCommandMethodHandlers = {
  wait: async ({ positionals, flags, client }) => {
    writeCommandMessage(
      flags,
      await runClientCommand({ command: 'wait', positionals, flags, client }),
    );
    return true;
  },
  alert: async ({ positionals, flags, client }) => {
    writeCommandMessage(
      flags,
      await runClientCommand({ command: 'alert', positionals, flags, client }),
    );
    return true;
  },
  appstate: async ({ flags, client }) => {
    const result = (await runClientCommand({
      command: 'appstate',
      positionals: [],
      flags,
      client,
    })) as AppStateCommandResult;
    writeCommandOutput(flags, result, () => formatAppState(result));
    return true;
  },
  back: async ({ flags, client }) => {
    writeCommandMessage(
      flags,
      await runClientCommand({ command: 'back', positionals: [], flags, client }),
    );
    return true;
  },
  home: async ({ flags, client }) => {
    writeCommandMessage(
      flags,
      await runClientCommand({ command: 'home', positionals: [], flags, client }),
    );
    return true;
  },
  rotate: async ({ positionals, flags, client }) => {
    writeCommandMessage(
      flags,
      await runClientCommand({ command: 'rotate', positionals, flags, client }),
    );
    return true;
  },
  'app-switcher': async ({ flags, client }) => {
    writeCommandMessage(
      flags,
      await runClientCommand({ command: 'app-switcher', positionals: [], flags, client }),
    );
    return true;
  },
  keyboard: async ({ positionals, flags, client }) => {
    writeKeyboardOutput(
      flags,
      (await runClientCommand({
        command: 'keyboard',
        positionals,
        flags,
        client,
      })) as KeyboardCommandResult,
    );
    return true;
  },
  clipboard: async ({ positionals, flags, client }) => {
    writeClipboardOutput(
      flags,
      (await runClientCommand({
        command: 'clipboard',
        positionals,
        flags,
        client,
      })) as ClipboardCommandResult,
    );
    return true;
  },
} satisfies ClientCommandHandlerMap;

function runClientCommand(options: {
  command:
    | 'wait'
    | 'alert'
    | 'appstate'
    | 'back'
    | 'home'
    | 'rotate'
    | 'app-switcher'
    | 'keyboard'
    | 'clipboard';
  positionals: string[];
  flags: CliFlags;
  client: Parameters<typeof runSemanticCliCommand>[0]['client'];
}) {
  return runSemanticCliCommand(options);
}

function writeKeyboardOutput(flags: CliFlags, result: KeyboardCommandResult): void {
  writeCommandOutput(flags, result, () => {
    if (result.platform === 'android' && result.action === 'status') {
      const lines = [
        `Keyboard visible: ${result.visible === true ? 'yes' : 'no'}`,
        `Input type: ${result.type ?? result.inputType ?? 'unknown'}`,
        `Input owner: ${result.inputOwner ?? 'unknown'}`,
      ];
      if (result.inputMethodPackage) lines.push(`Input method: ${result.inputMethodPackage}`);
      if (result.focusedPackage) lines.push(`Focused package: ${result.focusedPackage}`);
      if (result.focusedResourceId) lines.push(`Focused resource: ${result.focusedResourceId}`);
      lines.push(`Next action: ${androidKeyboardNextAction(result.visible, result.inputOwner)}`);
      return lines.join('\n');
    }
    return readCommandMessage(result);
  });
}

function androidKeyboardNextAction(
  visible: boolean | undefined,
  inputOwner: KeyboardCommandResult['inputOwner'],
): string {
  if (inputOwner === 'ime') {
    return 'Focused input appears to be owned by the keyboard/IME; dismiss or change the IME before retrying text entry.';
  }
  if (visible === true) {
    return 'Keyboard is visible and focused input appears app-owned; fill/type can proceed.';
  }
  return 'Keyboard is hidden; focus an app field before type, or use fill with a concrete target.';
}

function formatAppState(data: AppStateCommandResult): string | null {
  if (data.platform === 'ios') {
    const lines = [`Foreground app: ${data.appName ?? data.appBundleId ?? 'unknown'}`];
    if (data.appBundleId) lines.push(`Bundle: ${data.appBundleId}`);
    if (data.source) lines.push(`Source: ${data.source}`);
    return lines.join('\n');
  }
  if (data.platform === 'android') {
    const lines = [`Foreground app: ${data.package ?? 'unknown'}`];
    if (data.activity) lines.push(`Activity: ${data.activity}`);
    return lines.join('\n');
  }
  return null;
}

function writeClipboardOutput(flags: CliFlags, result: ClipboardCommandResult): void {
  if (flags.json) {
    writeCommandOutput(flags, result);
    return;
  }
  if (result.action === 'read') {
    process.stdout.write(`${result.text}\n`);
    return;
  }
  writeCommandMessage(flags, result);
}
