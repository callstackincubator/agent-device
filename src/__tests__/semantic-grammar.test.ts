import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DAEMON_COMMAND_GROUPS, PUBLIC_COMMANDS } from '../command-catalog.ts';
import {
  readFillTargetFromPositionals,
  readInteractionTargetFromPositionals,
  readLongPressTargetFromPositionals,
  readSemanticInputFromCli,
  readWaitOptionsFromPositionals,
} from '../commands/semantic-grammar.ts';
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

test('wait grammar preserves CLI bare text forms', () => {
  const options = readWaitOptionsFromPositionals(['Continue', '1500'], BASE_FLAGS);
  assert.equal(options.text, 'Continue');
  assert.equal(options.timeoutMs, 1500);
});

test('interaction and fill grammar share ref, selector, and point parsing', () => {
  assert.deepEqual(readInteractionTargetFromPositionals(['@e3', 'Email']), {
    ref: '@e3',
    label: 'Email',
  });
  assert.deepEqual(readFillTargetFromPositionals(['id=email', 'qa@example.com']), {
    kind: 'selector',
    target: { selector: 'id=email' },
    text: 'qa@example.com',
  });
  assert.deepEqual(readFillTargetFromPositionals(['@e4', 'Email', 'qa@example.com']), {
    kind: 'ref',
    target: { ref: '@e4', label: 'Email' },
    text: 'qa@example.com',
  });
  assert.deepEqual(readFillTargetFromPositionals(['10', '20', 'hello']), {
    kind: 'point',
    target: { x: 10, y: 20 },
    text: 'hello',
  });
  assert.deepEqual(readLongPressTargetFromPositionals(['@e4', '800']), {
    ref: '@e4',
    durationMs: 800,
  });
  assert.deepEqual(readLongPressTargetFromPositionals(['10', '20', '800']), {
    x: 10,
    y: 20,
    durationMs: 800,
  });
});

test('find and is grammar decodes command action positionals', () => {
  const findOptions = readSemanticInputFromCli('find', ['label', 'Continue', 'wait', '3000'], {
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

  const isOptions = readSemanticInputFromCli('is', ['text', 'id=title', 'Welcome'], BASE_FLAGS);
  assert.equal(isOptions.predicate, 'text');
  assert.equal(isOptions.selector, 'id=title');
  assert.equal(isOptions.value, 'Welcome');
});

test('settings grammar owns positional parsing for CLI commands', () => {
  const location = readSemanticInputFromCli(
    'settings',
    ['location', 'set', '37.3349', '-122.009'],
    {
      ...BASE_FLAGS,
      platform: 'ios',
    },
  );
  assert.equal(location.platform, 'ios');
  assert.equal(location.setting, 'location');
  assert.equal(location.state, 'set');
  assert.equal(location.latitude, 37.3349);
  assert.equal(location.longitude, -122.009);
});
