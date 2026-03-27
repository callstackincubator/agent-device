import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AppError } from '../../../utils/errors.ts';
import { resolveRequestedOpenSurface } from '../session-open-surface.ts';

test('resolveRequestedOpenSurface preserves existing macOS surface when flag is omitted', () => {
  const surface = resolveRequestedOpenSurface({
    device: {
      platform: 'macos',
      id: 'host-mac',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
    },
    surfaceFlag: undefined,
    openTarget: undefined,
    existingSurface: 'desktop',
  });

  assert.equal(surface, 'desktop');
});

test('resolveRequestedOpenSurface rejects surface flag on iOS', () => {
  assert.throws(
    () =>
      resolveRequestedOpenSurface({
        device: {
          platform: 'ios',
          id: 'sim-1',
          name: 'iPhone 17',
          kind: 'simulator',
        },
        surfaceFlag: 'desktop',
        openTarget: undefined,
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /surface is only supported on macOS/i.test(error.message),
  );
});

test('resolveRequestedOpenSurface allows an app target for macOS menubar sessions', () => {
  const surface = resolveRequestedOpenSurface({
    device: {
      platform: 'macos',
      id: 'host-mac',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
    },
    surfaceFlag: 'menubar',
    openTarget: 'Minisim',
  });

  assert.equal(surface, 'menubar');
});
