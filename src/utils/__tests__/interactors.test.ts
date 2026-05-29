import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { RunnerCommand } from '../../platforms/ios/runner-client.ts';
import type { DeviceInfo } from '../device.ts';

vi.mock('../../platforms/ios/runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/runner-client.ts')>();
  return { ...actual, runIosRunnerCommand: vi.fn() };
});

import { getInteractor } from '../../core/interactors.ts';
import { resolveAppleBackRunnerCommand } from '../../platforms/ios/interactions.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

const mockRunIosRunnerCommand = vi.mocked(runIosRunnerCommand);

beforeEach(() => {
  vi.restoreAllMocks();
  mockRunIosRunnerCommand.mockReset();
});

test('resolveAppleBackRunnerCommand defaults plain back to in-app navigation', () => {
  assert.equal(resolveAppleBackRunnerCommand(), 'backInApp');
});

test('resolveAppleBackRunnerCommand maps explicit back modes to runner commands', () => {
  assert.equal(resolveAppleBackRunnerCommand('in-app'), 'backInApp');
  assert.equal(resolveAppleBackRunnerCommand('system'), 'backSystem');
});

test('ios scroll reports planned pixels without recomputing from runner coordinates', async () => {
  mockRunIosRunnerCommand.mockImplementation(async (_device, command) => {
    if (command.command === 'interactionFrame') {
      return {
        x: 5,
        y: 10,
        referenceWidth: 300,
        referenceHeight: 600,
      };
    }
    if (command.command === 'drag') {
      return {
        x: 155,
        y: 420,
        x2: 155,
        y2: 301,
        referenceWidth: 300,
        referenceHeight: 600,
      };
    }
    throw new Error(`Unexpected runner command: ${command.command}`);
  });
  const interactor = await getInteractor(iosSimulator, { appBundleId: 'com.example.app' });
  const result = await interactor.scroll('down', { pixels: 120 });

  const pixels =
    result && typeof result === 'object' && 'pixels' in result ? result.pixels : undefined;
  assert.equal(pixels, 120);
});

test('ios fill sends one verified replacement text-entry command at the target coordinates', async () => {
  const commands: RunnerCommand[] = [];
  mockRunIosRunnerCommand.mockImplementation(async (_device, command) => {
    commands.push(command);
    return {};
  });
  const interactor = await getInteractor(iosSimulator, { appBundleId: 'com.example.app' });

  await interactor.fill(120, 240, 'hunter2');

  assert.deepEqual(commands, [
    {
      command: 'type',
      x: 120,
      y: 240,
      text: 'hunter2',
      textEntryMode: 'replace',
      delayMs: undefined,
      appBundleId: 'com.example.app',
    },
  ]);
});

test('ios type uses verified append text-entry mode', async () => {
  const commands: RunnerCommand[] = [];
  mockRunIosRunnerCommand.mockImplementation(async (_device, command) => {
    commands.push(command);
    return {};
  });
  const interactor = await getInteractor(iosSimulator, { appBundleId: 'com.example.app' });

  await interactor.type('hello', 25);

  assert.deepEqual(commands, [
    {
      command: 'type',
      text: 'hello',
      delayMs: 25,
      textEntryMode: 'append',
      appBundleId: 'com.example.app',
    },
  ]);
});
