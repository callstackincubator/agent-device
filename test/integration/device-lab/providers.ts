import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import type {
  AppleMacOsHostProvider,
  AppleToolCommandExecutor,
  AppleToolProvider,
  AppleToolSubcommandExecutor,
} from '../../../src/platforms/ios/tool-provider.ts';
import type { ExecResult } from '../../../src/utils/exec.ts';
import type { DeviceLabTranscript } from './transcript.ts';

export type FlatToolCall = [string, ...string[]];

type RecordingAppleToolHandlers = {
  runCommand?: AppleToolCommandExecutor;
  simctl?: AppleToolSubcommandExecutor;
  devicectl?: AppleToolSubcommandExecutor;
  macosHelper?: AppleToolSubcommandExecutor;
  macosHost?: AppleMacOsHostProvider;
};

export function createAppleRunnerProviderFromTranscript(
  transcript: DeviceLabTranscript,
  commandPrefix: 'ios.runner' | 'macos.runner' | 'tvos.runner',
): AppleRunnerProvider {
  return {
    runCommand: async (device, command) =>
      transcript.next(`${commandPrefix}.${command.command}`, command, {
        deviceId: device.id,
        platform: device.platform,
      }) as Record<string, unknown>,
  };
}

export function createRecordingAppleToolProvider(
  handler?: AppleToolCommandExecutor | RecordingAppleToolHandlers,
): {
  provider: AppleToolProvider;
  calls: FlatToolCall[];
} {
  const calls: FlatToolCall[] = [];
  const handlers = typeof handler === 'function' ? { runCommand: handler } : (handler ?? {});
  const fallbackResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
  return {
    calls,
    provider: {
      whichCommand: async () => true,
      runCommand: async (cmd, args, options) => {
        calls.push([cmd, ...args]);
        return handlers.runCommand ? await handlers.runCommand(cmd, args, options) : fallbackResult;
      },
      simctl: {
        run: async (args, options) => {
          calls.push(['simctl', ...args]);
          return handlers.simctl
            ? await handlers.simctl(args, options)
            : await (handlers.runCommand?.('xcrun', ['simctl', ...args], options) ??
                Promise.resolve(fallbackResult));
        },
      },
      devicectl: {
        run: async (args, options) => {
          calls.push(['devicectl', ...args]);
          return handlers.devicectl
            ? await handlers.devicectl(args, options)
            : await (handlers.runCommand?.('xcrun', ['devicectl', ...args], options) ??
                Promise.resolve(fallbackResult));
        },
      },
      macosHelper: {
        run: async (args, options) => {
          calls.push(['macos-helper', ...args]);
          return handlers.macosHelper
            ? await handlers.macosHelper(args, options)
            : await (handlers.runCommand?.('agent-device-macos-helper', args, options) ??
                Promise.resolve(fallbackResult));
        },
      },
      macosHost: createRecordingMacOsHostProvider(calls, handlers.macosHost),
    },
  };
}

function createRecordingMacOsHostProvider(
  calls: FlatToolCall[],
  host: AppleMacOsHostProvider | undefined,
): AppleMacOsHostProvider {
  return {
    openBundle: async (bundleId, url) => {
      calls.push(['macos-host', 'openBundle', bundleId, ...(url ? [url] : [])]);
      await host?.openBundle?.(bundleId, url);
    },
    openTarget: async (target) => {
      calls.push(['macos-host', 'openTarget', target]);
      await host?.openTarget?.(target);
    },
    readClipboard: async () => {
      calls.push(['macos-host', 'readClipboard']);
      return (await host?.readClipboard?.()) ?? '';
    },
    writeClipboard: async (text) => {
      calls.push(['macos-host', 'writeClipboard', text]);
      await host?.writeClipboard?.(text);
    },
    readDarkMode: async () => {
      calls.push(['macos-host', 'readDarkMode']);
      return (await host?.readDarkMode?.()) ?? false;
    },
    setDarkMode: async (enabled) => {
      calls.push(['macos-host', 'setDarkMode', String(enabled)]);
      await host?.setDarkMode?.(enabled);
    },
    listApps: async (filter) => {
      calls.push(['macos-host', 'listApps', filter]);
      return (await host?.listApps?.(filter)) ?? [];
    },
  };
}

export function simctlListDevicesJson(
  runtime: string,
  devices: Array<{ name: string; udid: string; state?: string; isAvailable?: boolean }>,
): ExecResult {
  return {
    stdout: `${JSON.stringify({
      devices: {
        [runtime]: devices.map((device) => ({
          state: 'Booted',
          isAvailable: true,
          ...device,
        })),
      },
    })}\n`,
    stderr: '',
    exitCode: 0,
  };
}
