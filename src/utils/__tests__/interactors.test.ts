import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppleBackRunnerCommand } from '../interactors.ts';

test('resolveAppleBackRunnerCommand keeps default back behavior when no mode is provided', () => {
  assert.equal(resolveAppleBackRunnerCommand(), 'back');
});

test('resolveAppleBackRunnerCommand maps explicit back modes to runner commands', () => {
  assert.equal(resolveAppleBackRunnerCommand('in-app'), 'backInApp');
  assert.equal(resolveAppleBackRunnerCommand('system'), 'backSystem');
});
