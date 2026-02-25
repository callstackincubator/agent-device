import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAppleProductType,
  isAppleTvProductType,
  isSupportedAppleDevicectlDevice,
  resolveAppleTargetFromDevicectlDevice,
} from '../devices.ts';

test('resolveAppleTargetFromDevicectlDevice detects tvOS from platform', () => {
  const target = resolveAppleTargetFromDevicectlDevice({
    hardwareProperties: { platform: 'tvOS' },
    deviceProperties: { name: 'Living Room' },
  });
  assert.equal(target, 'tv');
});

test('resolveAppleTargetFromDevicectlDevice detects AppleTV from product type', () => {
  const target = resolveAppleTargetFromDevicectlDevice({
    hardwareProperties: { platform: '' },
    deviceProperties: { name: 'Living Room', productType: 'AppleTV11,1' },
  });
  assert.equal(target, 'tv');
});

test('isSupportedAppleDevicectlDevice handles renamed AppleTV devices', () => {
  assert.equal(
    isSupportedAppleDevicectlDevice({
      hardwareProperties: { platform: '' },
      deviceProperties: { name: 'Living Room', productType: 'AppleTV11,1' },
    }),
    true,
  );
});

test('apple product type helpers classify iOS and tvOS product families', () => {
  assert.equal(isAppleProductType('iPhone16,2'), true);
  assert.equal(isAppleProductType('AppleTV11,1'), true);
  assert.equal(isAppleTvProductType('AppleTV11,1'), true);
  assert.equal(isAppleTvProductType('iPhone16,2'), false);
});
