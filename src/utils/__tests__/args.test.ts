import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, usage } from '../args.ts';

test('parseArgs recognizes --relaunch', () => {
  const parsed = parseArgs(['open', 'settings', '--relaunch']);
  assert.equal(parsed.command, 'open');
  assert.deepEqual(parsed.positionals, ['settings']);
  assert.equal(parsed.flags.relaunch, true);
});

test('parseArgs recognizes press series flags', () => {
  const parsed = parseArgs([
    'press',
    '300',
    '500',
    '--count',
    '12',
    '--interval-ms=45',
    '--hold-ms',
    '120',
    '--jitter-px',
    '3',
  ]);
  assert.equal(parsed.command, 'press');
  assert.deepEqual(parsed.positionals, ['300', '500']);
  assert.equal(parsed.flags.count, 12);
  assert.equal(parsed.flags.intervalMs, 45);
  assert.equal(parsed.flags.holdMs, 120);
  assert.equal(parsed.flags.jitterPx, 3);
});

test('parseArgs recognizes swipe positional + pattern flags', () => {
  const parsed = parseArgs([
    'swipe',
    '540',
    '1500',
    '540',
    '500',
    '120',
    '--count',
    '8',
    '--pause-ms',
    '30',
    '--pattern',
    'ping-pong',
  ]);
  assert.equal(parsed.command, 'swipe');
  assert.deepEqual(parsed.positionals, ['540', '1500', '540', '500', '120']);
  assert.equal(parsed.flags.count, 8);
  assert.equal(parsed.flags.pauseMs, 30);
  assert.equal(parsed.flags.pattern, 'ping-pong');
});

test('parseArgs rejects invalid swipe pattern', () => {
  assert.throws(
    () => parseArgs(['swipe', '0', '0', '10', '10', '--pattern', 'diagonal']),
    /Invalid pattern/,
  );
});

test('usage includes --relaunch flag', () => {
  assert.match(usage(), /--relaunch/);
});

test('usage includes swipe and press series options', () => {
  const help = usage();
  assert.match(help, /swipe <x1> <y1> <x2> <y2>/);
  assert.match(help, /--pattern one-way\|ping-pong/);
  assert.match(help, /--interval-ms/);
});
