import type { DeviceInfo } from '../utils/device.ts';
import { AppError } from '../utils/errors.ts';
import type { Interactor, RunnerContext } from './interactor-types.ts';
import { createAndroidInteractor } from './interactors/android.ts';
import { createAppleInteractor } from './interactors/apple.ts';
import { createLinuxInteractor } from './interactors/linux.ts';
import { createHarmonyInteractor } from './interactors/harmonyos.ts';

export function getInteractor(device: DeviceInfo, runnerContext: RunnerContext): Interactor {
  switch (device.platform) {
    case 'android':
      return createAndroidInteractor(device);
    case 'harmonyos':
      return createHarmonyInteractor(device);
    case 'linux':
      return createLinuxInteractor();
    case 'ios':
    case 'macos':
      return createAppleInteractor(device, runnerContext);
    default:
      throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform: ${device.platform}`);
  }
}
