import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import type {
  AppleToolCommandExecutor,
  AppleToolProvider,
} from '../../../src/platforms/ios/tool-provider.ts';
import type { ExecResult } from '../../../src/utils/exec.ts';
import type { DeviceLabTranscript } from './transcript.ts';

export type FlatToolCall = [string, ...string[]];

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

export function createRecordingAppleToolProvider(handler?: AppleToolCommandExecutor): {
  provider: AppleToolProvider;
  calls: FlatToolCall[];
} {
  const calls: FlatToolCall[] = [];
  return {
    calls,
    provider: {
      whichCommand: async () => true,
      runCommand: async (cmd, args, options) => {
        calls.push([cmd, ...args]);
        return handler
          ? await handler(cmd, args, options)
          : { stdout: '', stderr: '', exitCode: 0 };
      },
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
