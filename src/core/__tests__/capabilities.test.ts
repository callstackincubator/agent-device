import { test } from 'vitest';
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

const macOsDevice: DeviceInfo = {
  platform: 'macos',
  id: 'mac-1',
  name: 'Mac',
  kind: 'device',
  target: 'desktop',
};

const linuxDevice: DeviceInfo = {
  platform: 'linux',
  id: 'local',
  name: 'Linux Desktop',
  kind: 'device',
  target: 'desktop',
};

const tvOsSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'tv-sim-1',
  name: 'Apple TV',
  kind: 'simulator',
  target: 'tv',
};

type SupportCheck = {
  device: DeviceInfo;
  expected: boolean;
  label: string;
};

function assertCommandSupport(commands: string[], checks: SupportCheck[]): void {
  for (const command of commands) {
    for (const check of checks) {
      assert.equal(
        isCommandSupportedOnDevice(command, check.device),
        check.expected,
        `${command} ${check.label}`,
      );
    }
  }
}

test('device capability matrix stays consistent across shared command groups', () => {
  const scenarios: Array<{ commands: string[]; checks: SupportCheck[] }> = [
    {
      commands: ['alert', 'pinch'],
      checks: [
        { device: iosSimulator, expected: true, label: 'on iOS sim' },
        { device: iosDevice, expected: false, label: 'on iOS device' },
        { device: androidDevice, expected: false, label: 'on Android' },
        { device: macOsDevice, expected: true, label: 'on macOS' },
      ],
    },
    {
      commands: ['settings', 'clipboard'],
      checks: [
        { device: iosSimulator, expected: true, label: 'on iOS sim' },
        { device: iosDevice, expected: false, label: 'on iOS device' },
        { device: androidDevice, expected: true, label: 'on Android' },
        { device: macOsDevice, expected: true, label: 'on macOS' },
      ],
    },
    {
      commands: ['push'],
      checks: [
        { device: iosSimulator, expected: true, label: 'on iOS sim' },
        { device: iosDevice, expected: false, label: 'on iOS device' },
        { device: androidDevice, expected: true, label: 'on Android' },
        { device: macOsDevice, expected: false, label: 'on macOS' },
      ],
    },
    {
      commands: ['keyboard'],
      checks: [
        { device: iosSimulator, expected: true, label: 'on iOS sim' },
        { device: iosDevice, expected: true, label: 'on iOS device' },
        { device: androidDevice, expected: true, label: 'on Android' },
      ],
    },
    {
      commands: ['reinstall', 'install'],
      checks: [
        { device: iosSimulator, expected: true, label: 'on iOS sim' },
        { device: iosDevice, expected: true, label: 'on iOS device' },
        { device: androidDevice, expected: true, label: 'on Android' },
        { device: macOsDevice, expected: false, label: 'on macOS' },
      ],
    },
    {
      commands: ['swipe'],
      checks: [
        { device: iosSimulator, expected: true, label: 'on iOS sim' },
        { device: iosDevice, expected: true, label: 'on iOS device' },
        { device: androidDevice, expected: true, label: 'on Android' },
        { device: macOsDevice, expected: true, label: 'on macOS' },
      ],
    },
  ];

  for (const scenario of scenarios) {
    assertCommandSupport(scenario.commands, scenario.checks);
  }
});

test('core commands support iOS simulator, iOS device, and Android', () => {
  assertCommandSupport(
    [
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
      'install',
      'longpress',
      'logs',
      'open',
      'perf',
      'press',
      'record',
      'rotate',
      'screenshot',
      'scroll',
      'snapshot',
      'trigger-app-event',
      'type',
      'wait',
    ],
    [
      { device: iosSimulator, expected: true, label: 'on iOS sim' },
      { device: iosDevice, expected: true, label: 'on iOS device' },
      { device: androidDevice, expected: true, label: 'on Android' },
    ],
  );
});

test('macOS supports the Apple runner interaction core but excludes mobile-only commands', () => {
  assertCommandSupport(
    [
      'alert',
      'apps',
      'back',
      'click',
      'close',
      'diff',
      'fill',
      'find',
      'focus',
      'get',
      'is',
      'longpress',
      'logs',
      'network',
      'open',
      'pinch',
      'perf',
      'press',
      'record',
      'settings',
      'screenshot',
      'scroll',
      'snapshot',
      'swipe',
      'trigger-app-event',
      'type',
      'wait',
    ],
    [{ device: macOsDevice, expected: true, label: 'on macOS' }],
  );
  assertCommandSupport(
    [
      'app-switcher',
      'boot',
      'home',
      'install',
      'install-from-source',
      'push',
      'reinstall',
      'rotate',
    ],
    [{ device: macOsDevice, expected: false, label: 'on macOS' }],
  );
});

test('Android TV uses Android capabilities for core commands', () => {
  assertCommandSupport(
    ['open', 'apps', 'snapshot', 'press', 'swipe', 'back', 'home', 'scroll'],
    [{ device: androidTvDevice, expected: true, label: 'on Android TV' }],
  );
});

test('tvOS follows iOS capability matrix by device kind', () => {
  assertCommandSupport(
    ['open', 'close', 'apps', 'screenshot', 'trigger-app-event', 'logs', 'reinstall', 'boot'],
    [{ device: tvOsSimulator, expected: true, label: 'on tvOS' }],
  );
  assertCommandSupport(
    [
      'snapshot',
      'wait',
      'press',
      'get',
      'fill',
      'scroll',
      'back',
      'home',
      'app-switcher',
      'record',
    ],
    [{ device: tvOsSimulator, expected: true, label: 'on tvOS' }],
  );
  assertCommandSupport(
    ['pinch', 'push', 'settings', 'alert'],
    [{ device: tvOsSimulator, expected: true, label: 'on tvOS simulator' }],
  );
  assert.equal(
    isCommandSupportedOnDevice('keyboard', tvOsSimulator),
    false,
    'keyboard on tvOS simulator',
  );
  assert.equal(
    isCommandSupportedOnDevice('rotate', tvOsSimulator),
    false,
    'rotate on tvOS simulator',
  );
});

test('Linux supports desktop interaction commands and blocks mobile/unsupported ones', () => {
  assertCommandSupport(
    [
      'back',
      'click',
      'clipboard',
      'close',
      'diff',
      'fill',
      'find',
      'focus',
      'get',
      'home',
      'is',
      'longpress',
      'open',
      'press',
      'screenshot',
      'scroll',
      'snapshot',
      'swipe',
      'type',
      'wait',
    ],
    [{ device: linuxDevice, expected: true, label: 'on Linux' }],
  );
  assertCommandSupport(
    [
      'alert',
      'app-switcher',
      'apps',
      'boot',
      'install',
      'install-from-source',
      'keyboard',
      'logs',
      'network',
      'perf',
      'pinch',
      'push',
      'record',
      'reinstall',
      'rotate',
      'settings',
      'trigger-app-event',
    ],
    [{ device: linuxDevice, expected: false, label: 'on Linux' }],
  );
});

test('unknown commands default to supported', () => {
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', iosSimulator), true);
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', androidDevice), true);
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', linuxDevice), true);
});
