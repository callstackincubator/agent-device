import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, usage } from '../args.ts';

test('parseArgs recognizes --relaunch', () => {
  const parsed = parseArgs(['open', 'settings', '--relaunch']);
  assert.equal(parsed.command, 'open');
  assert.deepEqual(parsed.positionals, ['settings']);
  assert.equal(parsed.flags.relaunch, true);
});

test('usage includes --relaunch flag', () => {
  assert.match(usage(), /--relaunch/);
});
