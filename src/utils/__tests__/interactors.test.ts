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
  const interactor = getInteractor(iosSimulator, { appBundleId: 'com.example.app' });
  const result = await interactor.scroll('down', { pixels: 120 });

  const pixels =
    result && typeof result === 'object' && 'pixels' in result ? result.pixels : undefined;
  assert.equal(pixels, 120);
});

test('ios fill clears the focused field after tapping the target coordinates', async () => {
  const commands: RunnerCommand[] = [];
  mockRunIosRunnerCommand.mockImplementation(async (_device, command) => {
    commands.push(command);
    return {};
  });
  const interactor = getInteractor(iosSimulator, { appBundleId: 'com.example.app' });

  await interactor.fill(120, 240, 'hunter2');

  assert.deepEqual(commands, [
    { command: 'tap', x: 120, y: 240, appBundleId: 'com.example.app' },
    {
      command: 'type',
      text: 'hunter2',
      clearFirst: true,
      delayMs: undefined,
      appBundleId: 'com.example.app',
    },
  ]);
});
