import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DAEMON_COMMAND_GROUPS, PUBLIC_COMMANDS } from '../command-catalog.ts';
import { readInputFromCli } from '../commands/cli-grammar.ts';
import type { CliFlags } from '../utils/cli-flags.ts';

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
  const options = readInputFromCli('wait', ['Continue', '1500'], BASE_FLAGS);
  assert.equal(options.text, 'Continue');
  assert.equal(options.timeoutMs, 1500);
});

test('interaction and fill grammar share ref, selector, and point parsing', () => {
  assert.deepEqual(readInputFromCli('press', ['@e3', 'Email'], BASE_FLAGS).target, {
    kind: 'ref',
    ref: '@e3',
    label: 'Email',
  });
  const selectorFill = readInputFromCli('fill', ['id=email', 'qa@example.com'], BASE_FLAGS);
  assert.deepEqual(selectorFill.target, { kind: 'selector', selector: 'id=email' });
  assert.equal(selectorFill.text, 'qa@example.com');

  const refFill = readInputFromCli('fill', ['@e4', 'Email', 'qa@example.com'], BASE_FLAGS);
  assert.deepEqual(refFill.target, { kind: 'ref', ref: '@e4', label: 'Email' });
  assert.equal(refFill.text, 'qa@example.com');

  const pointFill = readInputFromCli('fill', ['10', '20', 'hello'], BASE_FLAGS);
  assert.deepEqual(pointFill.target, { kind: 'point', x: 10, y: 20 });
  assert.equal(pointFill.text, 'hello');

  assert.deepEqual(readInputFromCli('longpress', ['@e4', '800'], BASE_FLAGS), {
    target: { kind: 'ref', ref: '@e4' },
    durationMs: 800,
  });
  assert.deepEqual(readInputFromCli('longpress', ['10', '20', '800'], BASE_FLAGS), {
    target: { kind: 'point', x: 10, y: 20 },
    durationMs: 800,
  });
});

test('find and is grammar decodes command action positionals', () => {
  const findOptions = readInputFromCli('find', ['label', 'Continue', 'wait', '3000'], {
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

  const isOptions = readInputFromCli('is', ['text', 'id=title', 'Welcome'], BASE_FLAGS);
  assert.equal(isOptions.predicate, 'text');
  assert.equal(isOptions.selector, 'id=title');
  assert.equal(isOptions.value, 'Welcome');
});

test('settings grammar owns positional parsing for CLI commands', () => {
  const location = readInputFromCli('settings', ['location', 'set', '37.3349', '-122.009'], {
    ...BASE_FLAGS,
    platform: 'ios',
  });
  assert.equal(location.platform, 'ios');
  assert.equal(location.setting, 'location');
  assert.equal(location.state, 'set');
  assert.equal(location.latitude, 37.3349);
  assert.equal(location.longitude, -122.009);
});
