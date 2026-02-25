import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlatformSelector, resolveApplePlatformName } from '../device.ts';

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
