import { AppError } from '../utils/errors.ts';

export type DeviceRotation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

export function parseDeviceRotation(input: string | undefined): DeviceRotation {
  if (input === undefined) {
    throw new AppError(
      'INVALID_ARGS',
      'rotate requires an orientation argument. Use portrait|portrait-upside-down|landscape-left|landscape-right.',
    );
  }
  const normalized = input?.trim().toLowerCase();
  switch (normalized) {
    case 'portrait':
      return 'portrait';
    case 'portrait-upside-down':
    case 'upside-down':
      return 'portrait-upside-down';
    case 'landscape-left':
    case 'left':
      return 'landscape-left';
    case 'landscape-right':
    case 'right':
      return 'landscape-right';
    default:
      throw new AppError(
        'INVALID_ARGS',
        `Invalid rotation: ${input}. Use portrait|portrait-upside-down|landscape-left|landscape-right.`,
      );
  }
}
