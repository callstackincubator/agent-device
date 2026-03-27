import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunnerCommand } from '../../platforms/ios/runner-client.ts';
import type { DeviceInfo } from '../device.ts';
import { AppError } from '../errors.ts';
import {
  getInteractor,
  resolveAppleBackRunnerCommand,
  scrollIntoViewIosRunnerText,
} from '../interactors.ts';

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

test('ios scrollIntoView uses snapshot progress checks between swipes', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (cb: () => void, _ms: number) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  const commands: string[] = [];
  let findTextCalls = 0;
  let snapshotCalls = 0;
  const interactor = getInteractor(
    iosSimulator,
    { appBundleId: 'com.example.app' },
    {
      runIosRunnerCommand: async (_device, command) => {
        commands.push(command.command);
        if (command.command === 'findText') {
          findTextCalls += 1;
          return { found: findTextCalls > 2 };
        }
        if (command.command === 'snapshot') {
          snapshotCalls += 1;
          return {
            nodes: [{ type: 'XCUIElementTypeStaticText', label: `frame-${snapshotCalls}` }],
          };
        }
        if (command.command === 'swipe') return {};
        throw new Error(`Unexpected runner command: ${command.command}`);
      },
      sleepMs: async () => {},
    },
  );
  const result = await interactor.scrollIntoView('Target');

  assert.deepEqual(result, { attempts: 2 });
  assert.deepEqual(commands, [
    'findText',
    'snapshot',
    'swipe',
    'findText',
    'snapshot',
    'swipe',
    'findText',
  ]);
  assert.equal(snapshotCalls, 2);
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

test('scrollIntoViewIosRunnerText stops when post-swipe snapshots stall', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (cb: () => void, _ms: number) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  let snapshotCalls = 0;
  const runCommand = async (command: RunnerCommand): Promise<Record<string, unknown>> => {
    switch (command.command) {
      case 'findText':
        return { found: false };
      case 'snapshot':
        snapshotCalls += 1;
        return {
          nodes: [{ type: 'XCUIElementTypeStaticText', label: 'Still here' }],
        };
      case 'swipe':
        return {};
      default:
        throw new Error(`Unexpected command: ${command.command}`);
    }
  };

  await assert.rejects(
    () => scrollIntoViewIosRunnerText(runCommand, () => {}, 'Missing item', { maxScrolls: 4 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'COMMAND_FAILED');
      assert.equal(error.details?.reason, 'not_found');
      assert.equal(error.details?.attempts, 1);
      assert.equal(error.details?.stalled, true);
      return true;
    },
  );

  assert.equal(snapshotCalls, 2);
});
