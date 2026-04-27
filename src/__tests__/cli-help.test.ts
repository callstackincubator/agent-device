import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runCliCapture } from './cli-capture.ts';

test('help appstate prints command help and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'appstate']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /Show foreground app\/activity/);
  assert.doesNotMatch(result.stdout, /Command flags:/);
  assert.match(result.stdout, /Global flags:/);
});

test('help longpress prints command help and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'longpress']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /Usage:\n  agent-device longpress <x> <y> \[durationMs\]/);
});

test('help long-press resolves to longpress help and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'long-press']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /Usage:\n  agent-device longpress <x> <y> \[durationMs\]/);
  assert.doesNotMatch(result.stdout, /agent-device long-press/);
});

test('appstate --help prints command help and skips daemon dispatch', async () => {
  const result = await runCliCapture(['appstate', '--help']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /Usage:\n  agent-device appstate/);
  assert.match(result.stdout, /Global flags:/);
});

test('connect help documents cloud auth environment origins', async () => {
  const result = await runCliCapture(['help', 'connect']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /AGENT_DEVICE_CLOUD_BASE_URL/);
  assert.match(result.stdout, /bridge\/control-plane API origin/);
  assert.match(result.stdout, /AGENT_DEVICE_DAEMON_AUTH_TOKEN/);
});

test('help react-devtools prints agent workflow topic and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'react-devtools']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /agent-device help react-devtools/);
  assert.match(result.stdout, /React Native performance\/profiling/);
  assert.match(result.stdout, /agent-device react-devtools status/);
});

test('help workflow prints agent workflow topic and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'workflow']);
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.stdout, /agent-device help workflow/);
  assert.match(result.stdout, /Core loop:/);
  assert.match(result.stdout, /Do not use CSS selectors/);
});

test('help unknown command prints error plus global usage and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'not-a-command']);
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): Unknown command: not-a-command/);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /Flags:/);
  assert.match(result.stdout, /--config <path>/);
});

test('unknown command --help prints error plus global usage and skips daemon dispatch', async () => {
  const result = await runCliCapture(['not-a-command', '--help']);
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): Unknown command: not-a-command/);
  assert.match(result.stdout, /Commands:/);
});

test('runtime command is rejected before daemon dispatch', async () => {
  const result = await runCliCapture(['runtime', 'show']);
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): runtime command was removed/);
});

test('help rejects multiple positional commands and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'appstate', 'extra']);
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): help accepts at most one command/);
});
