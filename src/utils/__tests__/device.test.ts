import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlatformSelector, resolveApplePlatformName, selectDevice } from '../device.ts';
import type { DeviceInfo } from '../device.ts';
import { AppError } from '../errors.ts';

test('normalizePlatformSelector resolves apple alias to ios', () => {
  assert.equal(normalizePlatformSelector('apple'), 'ios');
  assert.equal(normalizePlatformSelector('ios'), 'ios');
  assert.equal(normalizePlatformSelector('android'), 'android');
  assert.equal(normalizePlatformSelector(undefined), undefined);
});

test('resolveApplePlatformName resolves tv targets to tvOS', () => {
  assert.equal(resolveApplePlatformName('tv'), 'tvOS');
  assert.equal(resolveApplePlatformName('mobile'), 'iOS');
  assert.equal(resolveApplePlatformName(undefined), 'iOS');
});

test('selectDevice throws DEVICE_NOT_FOUND with scoped set guidance when simulatorSetPath is set and no devices found', async () => {
  const setPath = '/path/to/sessions/abc/Simulators';
  const err = await selectDevice([], { platform: 'ios' }, { simulatorSetPath: setPath }).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
  assert.match(err.message, /scoped simulator set/);
  assert.equal(err.details?.simulatorSetPath, setPath);
  assert.ok(typeof err.details?.hint === 'string');
  assert.match(err.details.hint as string, /simctl --set/);
  assert.match(err.details.hint as string, /create/);
});

test('selectDevice throws generic DEVICE_NOT_FOUND when no simulatorSetPath and no devices found', async () => {
  const err = await selectDevice([], { platform: 'ios' }).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
  assert.equal(err.message, 'No devices found');
  assert.equal(err.details?.simulatorSetPath, undefined);
});

test('selectDevice does not apply scoped set guidance for non-iOS platform with simulatorSetPath', async () => {
  const setPath = '/path/to/sessions/abc/Simulators';
  const err = await selectDevice([], { platform: 'android' }, { simulatorSetPath: setPath }).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
  assert.equal(err.message, 'No devices found');
  assert.equal(err.details?.simulatorSetPath, undefined);
});

test('selectDevice applies scoped set guidance when no platform selector specified and simulatorSetPath is set', async () => {
  const setPath = '/path/to/sessions/abc/Simulators';
  const err = await selectDevice([], {}, { simulatorSetPath: setPath }).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'DEVICE_NOT_FOUND');
  assert.match(err.message, /scoped simulator set/);
  assert.equal(err.details?.simulatorSetPath, setPath);
});

test('selectDevice returns a device when candidates are available', async () => {
  const device: DeviceInfo = { platform: 'ios', id: 'abc123', name: 'iPhone 16', kind: 'simulator', booted: true };
  const result = await selectDevice([device], { platform: 'ios' });
  assert.equal(result.id, 'abc123');
});
