import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { clearIosSimulatorAppState, openIosApp } from '../../platforms/ios/apps.ts';
import { openAndroidApp } from '../../platforms/android/app-lifecycle.ts';
import { IOS_SIMULATOR } from '../../__tests__/test-utils/device-fixtures.ts';

vi.mock('../../platforms/ios/apps.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/apps.ts')>();
  return {
    ...actual,
    clearIosSimulatorAppState: vi.fn(async () => ({
      bundleId: 'com.example.app',
      containerPath: '/tmp/com.example.app',
    })),
    openIosApp: vi.fn(async () => {}),
  };
});

vi.mock('../../platforms/android/app-lifecycle.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../platforms/android/app-lifecycle.ts')>();
  return {
    ...actual,
    openAndroidApp: vi.fn(async () => {}),
  };
});

const mockClearIosSimulatorAppState = vi.mocked(clearIosSimulatorAppState);
const mockOpenIosApp = vi.mocked(openIosApp);
const mockOpenAndroidApp = vi.mocked(openAndroidApp);

beforeEach(() => {
  mockClearIosSimulatorAppState.mockClear();
  mockOpenIosApp.mockClear();
  mockOpenAndroidApp.mockClear();
});

test('dispatch open rejects URL as first argument when second URL is provided', async () => {
  const device: DeviceInfo = {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone 15',
    kind: 'simulator',
    booted: true,
  };

  await assert.rejects(
    () => dispatchCommand(device, 'open', ['myapp://first', 'myapp://second']),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /requires an app target as the first argument/i);
      return true;
    },
  );
});

test('dispatch open forwards Android launch arguments to openAndroidApp', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  await dispatchCommand(device, 'open', ['com.example.app'], undefined, {
    launchArgs: ['--es', 'KEY', 'value'],
  });

  assert.equal(mockOpenAndroidApp.mock.calls.length, 1);
  assert.equal(mockOpenAndroidApp.mock.calls[0]?.[0], device);
  assert.equal(mockOpenAndroidApp.mock.calls[0]?.[1], 'com.example.app');
  const optionsArg = mockOpenAndroidApp.mock.calls[0]?.[2];
  assert.ok(optionsArg && typeof optionsArg === 'object', 'expected options object');
  assert.deepEqual(optionsArg.launchArgs, ['--es', 'KEY', 'value']);
});

test('dispatch open clears Maestro iOS simulator state and launches once', async () => {
  const result = await dispatchCommand(IOS_SIMULATOR, 'open', ['com.example.app'], undefined, {
    clearAppState: true,
    launchArgs: ['-EXDevMenuIsOnboardingFinished', 'true'],
  });

  assert.equal(result?.app, 'com.example.app');
  assert.equal(mockClearIosSimulatorAppState.mock.calls.length, 1);
  assert.deepEqual(mockClearIosSimulatorAppState.mock.calls[0]?.slice(0, 2), [
    IOS_SIMULATOR,
    'com.example.app',
  ]);
  assert.equal(mockOpenIosApp.mock.calls.length, 1);
  assert.equal(mockOpenIosApp.mock.calls[0]?.[0], IOS_SIMULATOR);
  assert.equal(mockOpenIosApp.mock.calls[0]?.[1], 'com.example.app');
  assert.deepEqual(mockOpenIosApp.mock.calls[0]?.[2]?.launchArgs, [
    '-EXDevMenuIsOnboardingFinished',
    'true',
  ]);
});
