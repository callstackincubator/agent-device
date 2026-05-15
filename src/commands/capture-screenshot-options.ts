import { AppError } from '../utils/errors.ts';

export const SCREENSHOT_COMMAND_FLAG_KEYS = [
  'out',
  'overlayRefs',
  'screenshotFullscreen',
  'screenshotMaxSize',
  'screenshotNoStabilize',
] as const;

export const SCREENSHOT_ACTION_FLAG_KEYS = [
  'screenshotFullscreen',
  'screenshotMaxSize',
  'screenshotNoStabilize',
] as const;

export type ScreenshotRequestFlags = {
  out?: string;
  overlayRefs?: boolean;
  screenshotFullscreen?: boolean;
  screenshotMaxSize?: number;
  screenshotNoStabilize?: boolean;
};

export type ScreenshotDispatchFlags = Pick<
  ScreenshotRequestFlags,
  'screenshotFullscreen' | 'screenshotNoStabilize'
>;

export type ScreenshotRuntimeFlags = Pick<
  ScreenshotRequestFlags,
  'screenshotFullscreen' | 'screenshotMaxSize' | 'screenshotNoStabilize'
>;

export type ScreenshotPublicOptions = {
  overlayRefs?: boolean;
  fullscreen?: boolean;
  maxSize?: number;
  stabilize?: boolean;
};

export type ScreenshotRuntimeOptions = {
  overlayRefs?: boolean;
  fullscreen?: boolean;
  maxSize?: number;
  stabilize?: boolean;
};

export function screenshotOptionsFromFlags(
  flags: Partial<ScreenshotRequestFlags> | undefined,
): ScreenshotRuntimeOptions {
  return stripUndefined({
    overlayRefs: flags?.overlayRefs,
    fullscreen: flags?.screenshotFullscreen,
    maxSize: flags?.screenshotMaxSize,
    stabilize: flags?.screenshotNoStabilize ? false : undefined,
  });
}

export function screenshotFlagsFromOptions(
  options: ScreenshotPublicOptions & Partial<ScreenshotRequestFlags> = {},
): Partial<ScreenshotRequestFlags> {
  return stripUndefined({
    overlayRefs: options.overlayRefs,
    screenshotFullscreen: options.screenshotFullscreen ?? options.fullscreen,
    screenshotMaxSize: options.screenshotMaxSize ?? options.maxSize,
    screenshotNoStabilize:
      options.screenshotNoStabilize ?? (options.stabilize === false ? true : undefined),
  });
}

export function appendScreenshotScriptFlags(
  parts: string[],
  flags: Partial<ScreenshotRequestFlags> | undefined,
): void {
  if (flags?.screenshotFullscreen) parts.push('--fullscreen');
  if (typeof flags?.screenshotMaxSize === 'number') {
    parts.push('--max-size', String(flags.screenshotMaxSize));
  }
  if (flags?.screenshotNoStabilize) parts.push('--no-stabilize');
}

export function readScreenshotScriptFlag(params: {
  args: readonly string[];
  index: number;
  flags: Partial<ScreenshotRequestFlags>;
}): { handled: true; nextIndex: number } | { handled: false } {
  const { args, flags, index } = params;
  const token = args[index];
  if (token === '--fullscreen') {
    flags.screenshotFullscreen = true;
    return { handled: true, nextIndex: index };
  }
  if (token === '--no-stabilize') {
    flags.screenshotNoStabilize = true;
    return { handled: true, nextIndex: index };
  }
  if (token === '--max-size') {
    const value = args[index + 1];
    const maxSize = value === undefined ? NaN : Number(value);
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new AppError('INVALID_ARGS', 'screenshot --max-size requires a positive integer');
    }
    flags.screenshotMaxSize = maxSize;
    return { handled: true, nextIndex: index + 1 };
  }
  return { handled: false };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T;
}
