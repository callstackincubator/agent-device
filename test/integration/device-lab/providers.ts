import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import type { DeviceLabTranscript } from './transcript.ts';

export function createAppleRunnerProviderFromTranscript(
  transcript: DeviceLabTranscript,
  commandPrefix: 'ios.runner' | 'tvos.runner',
): AppleRunnerProvider {
  return {
    runCommand: async (device, command) =>
      transcript.next(`${commandPrefix}.${command.command}`, command, {
        deviceId: device.id,
        platform: device.platform,
      }) as Record<string, unknown>,
  };
}
