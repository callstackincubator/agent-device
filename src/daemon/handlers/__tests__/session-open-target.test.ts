import { beforeEach, expect, test, vi } from 'vitest';
import type { DeviceInfo } from '../../../utils/device.ts';

vi.mock('../../../platforms/android/index.ts', () => ({
  getAndroidAppState: vi.fn(),
}));

import { getAndroidAppState } from '../../../platforms/android/index.ts';
import { inferAndroidPackageAfterOpen } from '../session-open-target.ts';

const mockGetAndroidAppState = vi.mocked(getAndroidAppState);
const androidDevice: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel Emulator',
  kind: 'emulator',
  booted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

test('inferAndroidPackageAfterOpen reads foreground package for Android URL opens', async () => {
  mockGetAndroidAppState.mockResolvedValue({
    package: 'host.exp.exponent',
    activity: 'host.exp.exponent.experience.ExperienceActivity',
  });

  await expect(
    inferAndroidPackageAfterOpen(androidDevice, 'exp://127.0.0.1:8082', undefined),
  ).resolves.toBe('host.exp.exponent');
});

test('inferAndroidPackageAfterOpen preserves existing package context', async () => {
  await expect(
    inferAndroidPackageAfterOpen(androidDevice, 'exp://127.0.0.1:8082', 'com.example.app'),
  ).resolves.toBe('com.example.app');
  expect(mockGetAndroidAppState).not.toHaveBeenCalled();
});
