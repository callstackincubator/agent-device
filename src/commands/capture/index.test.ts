import { describe, expect, test } from 'vitest';
import type { CliFlags } from '../../utils/cli-flags.ts';
import {
  alertCliReader,
  alertDaemonWriter,
  diffCliReader,
  screenshotCliReader,
  screenshotDaemonWriter,
  settingsCliReader,
  settingsDaemonWriter,
  snapshotCliReader,
  waitCliReader,
  waitDaemonWriter,
} from './index.ts';

function flags(overrides: Partial<CliFlags> = {}): CliFlags {
  return overrides as CliFlags;
}

function expectInvalidArgs(fn: () => unknown, messageFragment: string) {
  expect(fn).toThrow(
    expect.objectContaining({
      code: 'INVALID_ARGS',
      message: expect.stringContaining(messageFragment),
    }),
  );
}

describe('capture command interface', () => {
  test('reads snapshot flags', () => {
    expect(
      snapshotCliReader(
        [],
        flags({
          snapshotInteractiveOnly: true,
          snapshotCompact: true,
          snapshotDepth: 3,
          snapshotScope: 'Login',
          snapshotRaw: true,
          snapshotForceFull: true,
          timeoutMs: 10_000,
        }),
      ),
    ).toMatchObject({
      interactiveOnly: true,
      compact: true,
      depth: 3,
      scope: 'Login',
      raw: true,
      forceFull: true,
      timeoutMs: 10_000,
    });
  });

  test('reads screenshot path and writes screenshot flags', () => {
    const input = screenshotCliReader(
      ['page.png'],
      flags({ screenshotFullscreen: true, screenshotMaxSize: 1024 }),
    );
    expect(input).toMatchObject({ path: 'page.png', fullscreen: true, maxSize: 1024 });
    expect(screenshotDaemonWriter(input)).toMatchObject({
      command: 'screenshot',
      positionals: ['page.png'],
      options: { screenshotFullscreen: true, screenshotMaxSize: 1024 },
    });
  });

  test('reads diff snapshot input only', () => {
    expect(
      diffCliReader(['snapshot'], flags({ snapshotDepth: 4, out: './diff.json' })),
    ).toMatchObject({
      kind: 'snapshot',
      depth: 4,
      out: './diff.json',
    });
    expectInvalidArgs(() => diffCliReader(['screenshot'], flags()), 'Only diff snapshot');
  });

  test('reads and writes wait targets', () => {
    expect(waitCliReader(['text', 'Ready', '5000'], flags())).toMatchObject({
      text: 'Ready',
      timeoutMs: 5000,
    });
    expect(waitDaemonWriter({ text: 'Ready', timeoutMs: 5000 })).toMatchObject({
      command: 'wait',
      positionals: ['text', 'Ready', '5000'],
    });
    expectInvalidArgs(() => waitDaemonWriter({ text: 'Ready', ref: '@e1' }), 'exactly one');
  });

  test('reads and writes alert action and timeout', () => {
    expect(alertCliReader(['wait', '3000'], flags())).toMatchObject({
      action: 'wait',
      timeoutMs: 3000,
    });
    expect(alertDaemonWriter({ action: 'dismiss', timeoutMs: 1000 })).toMatchObject({
      command: 'alert',
      positionals: ['dismiss', '1000'],
    });
  });

  test('reads and writes settings input', () => {
    const input = settingsCliReader(['permission', 'grant', 'camera', 'limited'], flags());
    expect(input).toMatchObject({
      setting: 'permission',
      state: 'grant',
      permission: 'camera',
      mode: 'limited',
    });
    expect(settingsDaemonWriter(input)).toMatchObject({
      command: 'settings',
      positionals: ['permission', 'grant', 'camera', 'limited'],
    });
  });
});
