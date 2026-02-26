import test from 'node:test';
import assert from 'node:assert/strict';
import { isCommandSupportedOnDevice } from '../capabilities.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone',
  kind: 'simulator',
};

const iosDevice: DeviceInfo = {
  platform: 'ios',
  id: 'dev-1',
  name: 'iPhone',
  kind: 'device',
};

const androidDevice: DeviceInfo = {
  platform: 'android',
  id: 'and-1',
  name: 'Pixel',
  kind: 'device',
};

const androidTvDevice: DeviceInfo = {
  platform: 'android',
  id: 'and-tv-1',
  name: 'Android TV',
  kind: 'device',
  target: 'tv',
};

const tvOsSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'tv-sim-1',
  name: 'Apple TV',
  kind: 'simulator',
  target: 'tv',
};

test('iOS simulator-only commands reject iOS devices and Android', () => {
  for (const cmd of ['alert', 'pinch']) {
    assert.equal(isCommandSupportedOnDevice(cmd, iosSimulator), true, `${cmd} on iOS sim`);
    assert.equal(isCommandSupportedOnDevice(cmd, iosDevice), false, `${cmd} on iOS device`);
    assert.equal(isCommandSupportedOnDevice(cmd, androidDevice), false, `${cmd} on Android`);
  }
});

test('simulator-only iOS commands with Android support reject iOS devices', () => {
  for (const cmd of ['settings', 'push', 'clipboard']) {
    assert.equal(isCommandSupportedOnDevice(cmd, iosSimulator), true, `${cmd} on iOS sim`);
    assert.equal(isCommandSupportedOnDevice(cmd, iosDevice), false, `${cmd} on iOS device`);
    assert.equal(isCommandSupportedOnDevice(cmd, androidDevice), true, `${cmd} on Android`);
  }
});

test('keyboard command is Android-only', () => {
  assert.equal(isCommandSupportedOnDevice('keyboard', iosSimulator), false, 'keyboard on iOS sim');
  assert.equal(isCommandSupportedOnDevice('keyboard', iosDevice), false, 'keyboard on iOS device');
  assert.equal(isCommandSupportedOnDevice('keyboard', androidDevice), true, 'keyboard on Android');
});

test('swipe supports iOS simulator, iOS device, and Android', () => {
  assert.equal(isCommandSupportedOnDevice('swipe', iosSimulator), true, 'swipe on iOS sim');
  assert.equal(isCommandSupportedOnDevice('swipe', iosDevice), true, 'swipe on iOS device');
  assert.equal(isCommandSupportedOnDevice('swipe', androidDevice), true, 'swipe on Android');
});

test('reinstall supports iOS simulator, iOS device, and Android', () => {
  assert.equal(isCommandSupportedOnDevice('reinstall', iosSimulator), true, 'reinstall on iOS sim');
  assert.equal(isCommandSupportedOnDevice('reinstall', iosDevice), true, 'reinstall on iOS device');
  assert.equal(isCommandSupportedOnDevice('reinstall', androidDevice), true, 'reinstall on Android');
});

test('core commands support iOS simulator, iOS device, and Android', () => {
  for (const cmd of [
    'app-switcher',
    'apps',
    'back',
    'boot',
    'click',
    'close',
    'diff',
    'fill',
    'find',
    'focus',
    'get',
    'home',
    'longpress',
    'logs',
    'open',
    'perf',
    'press',
    'record',
    'screenshot',
    'scroll',
    'scrollintoview',
    'snapshot',
    'trigger-app-event',
    'type',
    'wait',
  ]) {
    assert.equal(isCommandSupportedOnDevice(cmd, iosSimulator), true, `${cmd} on iOS sim`);
    assert.equal(isCommandSupportedOnDevice(cmd, iosDevice), true, `${cmd} on iOS device`);
    assert.equal(isCommandSupportedOnDevice(cmd, androidDevice), true, `${cmd} on Android`);
  }
});

test('Android TV uses Android capabilities for core commands', () => {
  for (const cmd of ['open', 'apps', 'snapshot', 'press', 'swipe', 'back', 'home', 'scroll']) {
    assert.equal(isCommandSupportedOnDevice(cmd, androidTvDevice), true, `${cmd} on Android TV`);
  }
});

test('tvOS follows iOS capability matrix by device kind', () => {
  for (const cmd of [
    'open',
    'close',
    'apps',
    'screenshot',
    'trigger-app-event',
    'logs',
    'reinstall',
    'boot',
  ]) {
    assert.equal(isCommandSupportedOnDevice(cmd, tvOsSimulator), true, `${cmd} on tvOS`);
  }
  for (const cmd of ['snapshot', 'wait', 'press', 'get', 'fill', 'scroll', 'back', 'home', 'app-switcher', 'record']) {
    assert.equal(isCommandSupportedOnDevice(cmd, tvOsSimulator), true, `${cmd} on tvOS`);
  }
  for (const cmd of ['pinch', 'push', 'settings', 'alert']) {
    assert.equal(isCommandSupportedOnDevice(cmd, tvOsSimulator), true, `${cmd} on tvOS simulator`);
  }
  assert.equal(isCommandSupportedOnDevice('keyboard', tvOsSimulator), false, 'keyboard on tvOS simulator');
});

test('unknown commands default to supported', () => {
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', iosSimulator), true);
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', androidDevice), true);
});
