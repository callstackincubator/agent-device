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

const macOsDevice: DeviceInfo = {
  platform: 'macos',
  id: 'mac-1',
  name: 'Mac',
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
      ],
    },
    {
      commands: ['settings', 'push', 'clipboard'],
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
        { device: iosSimulator, expected: false, label: 'on iOS sim' },
        { device: iosDevice, expected: false, label: 'on iOS device' },
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
      'screenshot',
      'scroll',
      'scrollintoview',
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
      'open',
      'perf',
      'press',
      'record',
      'screenshot',
      'scroll',
      'scrollintoview',
      'snapshot',
      'swipe',
      'type',
      'wait',
    ],
    [{ device: macOsDevice, expected: true, label: 'on macOS' }],
  );
  assertCommandSupport(
    [
      'alert',
      'app-switcher',
      'boot',
      'clipboard',
      'home',
      'install',
      'install-from-source',
      'logs',
      'network',
      'pinch',
      'push',
      'reinstall',
      'settings',
      'trigger-app-event',
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
});

test('unknown commands default to supported', () => {
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', iosSimulator), true);
  assert.equal(isCommandSupportedOnDevice('some-future-cmd', androidDevice), true);
});
