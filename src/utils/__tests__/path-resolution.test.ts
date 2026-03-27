import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { expandUserHomePath, resolveUserPath } from '../path-resolution.ts';

test('expandUserHomePath expands the current user home prefix', () => {
  const env = { HOME: '/tmp/agent-device-home' };

  assert.equal(expandUserHomePath('~', { env }), '/tmp/agent-device-home');
  assert.equal(
    expandUserHomePath('~/flows/replay.ad', { env }),
    path.join('/tmp/agent-device-home', 'flows', 'replay.ad'),
  );
});

test('expandUserHomePath leaves non-home-prefixed paths unchanged', () => {
  const env = { HOME: '/tmp/agent-device-home' };

  assert.equal(expandUserHomePath('relative/path', { env }), 'relative/path');
  assert.equal(expandUserHomePath('~other/path', { env }), '~other/path');
});

test('resolveUserPath resolves relative paths against cwd', () => {
  assert.equal(
    resolveUserPath('workflows/replay.ad', { cwd: '/tmp/agent-device-cwd' }),
    path.resolve('/tmp/agent-device-cwd', 'workflows/replay.ad'),
  );
});

test('resolveUserPath expands home-prefixed and absolute paths', () => {
  const env = { HOME: '/tmp/agent-device-home' };
  const absolutePath = '/tmp/agent-device-absolute.ad';

  assert.equal(
    resolveUserPath('~/flows/replay.ad', { cwd: '/tmp/ignored', env }),
    path.join('/tmp/agent-device-home', 'flows', 'replay.ad'),
  );
  assert.equal(resolveUserPath(absolutePath, { cwd: '/tmp/ignored', env }), absolutePath);
});
