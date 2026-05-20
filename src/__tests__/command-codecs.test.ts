import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DAEMON_COMMAND_GROUPS, PUBLIC_COMMANDS } from '../command-catalog.ts';
import {
  fillCommandCodec,
  findCommandCodec,
  interactionTargetCodec,
  isCommandCodec,
  longPressCommandCodec,
  settingsCommandCodec,
  waitCommandCodec,
} from '../command-codecs.ts';
import type { CliFlags } from '../utils/command-schema.ts';

const BASE_FLAGS: CliFlags = {
  json: false,
  help: false,
  version: false,
};

test('command catalog owns daemon routing groups', () => {
  assert.equal(DAEMON_COMMAND_GROUPS.snapshot.has(PUBLIC_COMMANDS.wait), true);
  assert.equal(DAEMON_COMMAND_GROUPS.observability.has(PUBLIC_COMMANDS.logs), true);
  assert.equal(DAEMON_COMMAND_GROUPS.replay.has(PUBLIC_COMMANDS.test), true);
});

test('wait codec preserves CLI bare text and client selector forms', () => {
  const options = waitCommandCodec.decode(['Continue', '1500'], BASE_FLAGS);
  assert.equal(options.text, 'Continue');
  assert.equal(options.timeoutMs, 1500);
  assert.deepEqual(
    waitCommandCodec.encode({
      selector: 'id=submit',
      timeoutMs: 2000,
    }),
    ['id=submit', '2000'],
  );
});

test('interaction and fill codecs share ref, selector, and point grammar', () => {
  assert.deepEqual(interactionTargetCodec.decode(['@e3', 'Email']), {
    ref: '@e3',
    label: 'Email',
  });
  assert.deepEqual(interactionTargetCodec.encode({ selector: 'id=submit' }), ['id=submit']);
  assert.deepEqual(fillCommandCodec.decode(['id=email', 'qa@example.com']), {
    kind: 'selector',
    target: { selector: 'id=email' },
    text: 'qa@example.com',
  });
  assert.deepEqual(fillCommandCodec.decode(['@e4', 'Email', 'qa@example.com']), {
    kind: 'ref',
    target: { ref: '@e4', label: 'Email' },
    text: 'qa@example.com',
  });
  assert.deepEqual(fillCommandCodec.decode(['10', '20', 'hello']), {
    kind: 'point',
    target: { x: 10, y: 20 },
    text: 'hello',
  });
  assert.deepEqual(
    fillCommandCodec.encode({
      ref: '@e4',
      label: 'Email',
      text: 'qa@example.com',
    }),
    ['@e4', 'Email', 'qa@example.com'],
  );
  assert.deepEqual(longPressCommandCodec.decode(['@e4', '800']), {
    ref: '@e4',
    durationMs: 800,
  });
  assert.deepEqual(longPressCommandCodec.decode(['10', '20', '800']), {
    x: 10,
    y: 20,
    durationMs: 800,
  });
  assert.deepEqual(
    longPressCommandCodec.encode({ selector: 'label="Last message"', durationMs: 800 }),
    ['label="Last message"', '800'],
  );
});

test('find and is codecs round-trip command action positionals', () => {
  const findOptions = findCommandCodec.decode(['label', 'Continue', 'wait', '3000'], {
    ...BASE_FLAGS,
    platform: 'ios',
    findFirst: true,
  });
  assert.equal(findOptions.platform, 'ios');
  assert.equal(findOptions.locator, 'label');
  assert.equal(findOptions.query, 'Continue');
  assert.equal(findOptions.action, 'wait');
  assert.equal(findOptions.timeoutMs, 3000);
  assert.equal(findOptions.first, true);
  assert.deepEqual(findCommandCodec.encode(findOptions), ['label', 'Continue', 'wait', '3000']);

  const isOptions = isCommandCodec.decode(['text', 'id=title', 'Welcome'], BASE_FLAGS);
  assert.equal(isOptions.predicate, 'text');
  assert.equal(isOptions.selector, 'id=title');
  assert.equal(isOptions.value, 'Welcome');
  assert.deepEqual(isCommandCodec.encode(isOptions), ['text', 'id=title', 'Welcome']);
});

test('settings codec owns positional grammar for command and client paths', () => {
  const location = settingsCommandCodec.decode(['location', 'set', '37.3349', '-122.009'], {
    ...BASE_FLAGS,
    platform: 'ios',
  });
  assert.equal(location.platform, 'ios');
  assert.equal(location.setting, 'location');
  assert.equal(location.state, 'set');
  assert.equal(location.latitude, 37.3349);
  assert.equal(location.longitude, -122.009);
  assert.deepEqual(settingsCommandCodec.encode(location), [
    'location',
    'set',
    '37.3349',
    '-122.009',
  ]);

  assert.deepEqual(
    settingsCommandCodec.encode({
      setting: 'permission',
      state: 'grant',
      permission: 'camera',
      mode: 'limited',
    }),
    ['permission', 'grant', 'camera', 'limited'],
  );
});
