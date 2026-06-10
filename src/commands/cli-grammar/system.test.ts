import { describe, expect, test } from 'vitest';
import type { CliFlags } from '../../utils/cli-flags.ts';
import type { CommandInput } from './types.ts';
import { systemCliReaders, systemDaemonWriters } from './system.ts';

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

describe('system CLI readers', () => {
  test('the parameterless readers project the common selection flags through', () => {
    for (const command of ['appstate', 'home', 'app-switcher'] as const) {
      expect(systemCliReaders[command]([], flags({ platform: 'ios' }))).toEqual({
        platform: 'ios',
      });
    }
  });

  test('back reader forwards the configured back mode', () => {
    expect(systemCliReaders.back([], flags({ backMode: 'system' }))).toMatchObject({
      mode: 'system',
    });
  });

  test('rotate reader normalizes the orientation argument', () => {
    expect(systemCliReaders.rotate(['left'], flags())).toMatchObject({
      orientation: 'landscape-left',
    });
  });

  test('rotate reader rejects a missing orientation', () => {
    expectInvalidArgs(() => systemCliReaders.rotate([], flags()), 'rotate requires an orientation');
  });

  describe('keyboard reader', () => {
    test('maps the "get" alias to the status action', () => {
      expect(systemCliReaders.keyboard(['get'], flags())).toMatchObject({ action: 'status' });
    });

    test('omits the action entirely when no argument is given', () => {
      expect(systemCliReaders.keyboard([], flags())).not.toHaveProperty('action');
    });

    test('rejects more than one keyboard argument', () => {
      expectInvalidArgs(
        () => systemCliReaders.keyboard(['dismiss', 'extra'], flags()),
        'at most one action argument',
      );
    });

    test('rejects an unknown keyboard action', () => {
      expectInvalidArgs(
        () => systemCliReaders.keyboard(['wiggle'], flags()),
        'keyboard action must be',
      );
    });
  });

  describe('clipboard reader', () => {
    test('parses a read subcommand', () => {
      expect(systemCliReaders.clipboard(['read'], flags())).toMatchObject({ action: 'read' });
    });

    test('joins multi-word text for a write subcommand', () => {
      expect(systemCliReaders.clipboard(['write', 'hello', 'world'], flags())).toMatchObject({
        action: 'write',
        text: 'hello world',
      });
    });

    test('rejects a missing subcommand', () => {
      expectInvalidArgs(() => systemCliReaders.clipboard([], flags()), 'read or write');
    });

    test('rejects extra arguments after read', () => {
      expectInvalidArgs(
        () => systemCliReaders.clipboard(['read', 'oops'], flags()),
        'does not accept additional arguments',
      );
    });

    test('rejects a write without any text', () => {
      expectInvalidArgs(
        () => systemCliReaders.clipboard(['write'], flags()),
        'clipboard write requires text',
      );
    });
  });

  describe('react-native reader', () => {
    test('accepts the dismiss-overlay action', () => {
      expect(systemCliReaders['react-native'](['dismiss-overlay'], flags())).toMatchObject({
        action: 'dismiss-overlay',
      });
    });

    test('rejects any other react-native action', () => {
      expectInvalidArgs(
        () => systemCliReaders['react-native'](['reload'], flags()),
        'react-native supports only',
      );
    });
  });
});

describe('system daemon writers', () => {
  test('the direct writers emit their command with no positionals', () => {
    for (const command of ['appstate', 'home', 'app-switcher'] as const) {
      const request = systemDaemonWriters[command]({} as CommandInput);
      expect(request.command).toBe(command);
      expect(request.positionals).toEqual([]);
    }
  });

  test('back writer keeps recognized back modes', () => {
    expect(systemDaemonWriters.back({ mode: 'in-app' } as CommandInput).options).toMatchObject({
      backMode: 'in-app',
    });
  });

  test('back writer drops an unrecognized back mode', () => {
    const options = systemDaemonWriters.back({ mode: 'teleport' } as unknown as CommandInput)
      .options as Record<string, unknown>;
    expect(options.backMode).toBeUndefined();
  });

  test('rotate writer serializes the orientation positional', () => {
    expect(
      systemDaemonWriters.rotate({ orientation: 'portrait' } as CommandInput).positionals,
    ).toEqual(['portrait']);
  });

  test('rotate writer requires an orientation', () => {
    expectInvalidArgs(
      () => systemDaemonWriters.rotate({} as CommandInput),
      'rotate requires orientation',
    );
  });

  test('keyboard writer forwards the action when present and is empty otherwise', () => {
    expect(systemDaemonWriters.keyboard({ action: 'dismiss' } as CommandInput).positionals).toEqual(
      ['dismiss'],
    );
    expect(systemDaemonWriters.keyboard({} as CommandInput).positionals).toEqual([]);
  });

  test('clipboard writer serializes read and write subcommands', () => {
    expect(systemDaemonWriters.clipboard({ action: 'read' } as CommandInput).positionals).toEqual([
      'read',
    ]);
    expect(
      systemDaemonWriters.clipboard({ action: 'write', text: 'copied' } as CommandInput)
        .positionals,
    ).toEqual(['write', 'copied']);
  });

  test('react-native writer requires an action', () => {
    expect(
      systemDaemonWriters['react-native']({ action: 'dismiss-overlay' } as CommandInput)
        .positionals,
    ).toEqual(['dismiss-overlay']);
    expectInvalidArgs(
      () => systemDaemonWriters['react-native']({} as CommandInput),
      'react-native requires action',
    );
  });
});
