import { afterAll, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { pressLinux } from '../input-actions.ts';
import { resetInputToolCache } from '../linux-env.ts';
import { createLocalLinuxToolProvider, withLinuxToolProvider } from '../tool-provider.ts';

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  process.env['XDG_SESSION_TYPE'] = 'x11';
  delete process.env['WAYLAND_DISPLAY'];
  resetInputToolCache();
});

test('scoped Linux tool provider handles input discovery and command execution', async () => {
  const commands: Array<[string, string[]]> = [];
  const provider = createLocalLinuxToolProvider({
    whichCommand: async (cmd) => cmd === 'xdotool',
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });

  await withLinuxToolProvider(provider, async () => {
    await pressLinux(100, 200);
  });

  assert.deepEqual(commands, [
    ['xdotool', ['mousemove', '--sync', '100', '200']],
    ['xdotool', ['click', '1']],
  ]);
});

test('Linux tool provider scopes do not share cached input tool resolution', async () => {
  const providerA = createLocalLinuxToolProvider({
    whichCommand: async (cmd) => cmd === 'xdotool',
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  const providerB = createLocalLinuxToolProvider({
    whichCommand: async (cmd) => cmd === 'ydotool',
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });

  await withLinuxToolProvider(providerA, async () => {
    await pressLinux(1, 2);
  });

  process.env['XDG_SESSION_TYPE'] = 'wayland';
  process.env['WAYLAND_DISPLAY'] = 'wayland-0';
  const commands: Array<[string, string[]]> = [];

  await withLinuxToolProvider(
    createLocalLinuxToolProvider({
      ...providerB,
      runCommand: async (cmd, args) => {
        commands.push([cmd, args]);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    }),
    async () => {
      await pressLinux(3, 4);
    },
  );

  assert.deepEqual(commands, [
    ['ydotool', ['mousemove', '--absolute', '-x', '3', '-y', '4']],
    ['ydotool', ['click', '0xC0']],
  ]);
});

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});
