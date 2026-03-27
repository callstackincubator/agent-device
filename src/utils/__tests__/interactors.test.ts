import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeviceInfo } from '../device.ts';
import { getInteractor, resolveAppleBackRunnerCommand } from '../interactors.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

test('resolveAppleBackRunnerCommand defaults plain back to in-app navigation', () => {
  assert.equal(resolveAppleBackRunnerCommand(), 'backInApp');
});

test('resolveAppleBackRunnerCommand maps explicit back modes to runner commands', () => {
  assert.equal(resolveAppleBackRunnerCommand('in-app'), 'backInApp');
  assert.equal(resolveAppleBackRunnerCommand('system'), 'backSystem');
});

test('ios scrollIntoView reuses a single interactionFrame across a burst', async () => {
  const commands: string[] = [];
  let findTextCalls = 0;
  const interactor = getInteractor(
    iosSimulator,
    { appBundleId: 'com.example.app' },
    {
      runIosRunnerCommand: async (_device, command) => {
        commands.push(command.command);
        if (command.command === 'findText') {
          findTextCalls += 1;
          return { found: findTextCalls > 1 };
        }
        if (command.command === 'interactionFrame') {
          return {
            x: 10,
            y: 20,
            referenceWidth: 200,
            referenceHeight: 400,
          };
        }
        if (command.command === 'drag') {
          return {
            x: 110,
            y: 300,
            x2: 110,
            y2: 100,
            referenceWidth: 200,
            referenceHeight: 400,
          };
        }
        throw new Error(`Unexpected runner command: ${command.command}`);
      },
      sleepMs: async () => {},
    },
  );
  const result = await interactor.scrollIntoView('Target');

  assert.deepEqual(result, { attempts: 2 });
  assert.equal(commands.filter((command) => command === 'interactionFrame').length, 1);
  assert.equal(commands.filter((command) => command === 'drag').length, 4);
});

test('ios scroll reports planned pixels without recomputing from runner coordinates', async () => {
  const interactor = getInteractor(
    iosSimulator,
    { appBundleId: 'com.example.app' },
    {
      runIosRunnerCommand: async (_device, command) => {
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
      },
    },
  );
  const result = await interactor.scroll('down', { pixels: 120 });

  const pixels =
    result && typeof result === 'object' && 'pixels' in result ? result.pixels : undefined;
  assert.equal(pixels, 120);
});
