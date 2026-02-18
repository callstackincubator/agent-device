import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, toDaemonFlags, usage, usageForCommand } from '../args.ts';
import { AppError } from '../errors.ts';
import { getCliCommandNames, getSchemaCapabilityKeys } from '../command-schema.ts';
import { listCapabilityCommands } from '../../core/capabilities.ts';

test('parseArgs recognizes --relaunch', () => {
  const parsed = parseArgs(['open', 'settings', '--relaunch']);
  assert.equal(parsed.command, 'open');
  assert.deepEqual(parsed.positionals, ['settings']);
  assert.equal(parsed.flags.relaunch, true);
});

test('toDaemonFlags strips CLI-only flags', () => {
  const parsed = parseArgs(['open', 'settings', '--json']);
  const daemonFlags = toDaemonFlags(parsed.flags);
  assert.equal(Object.hasOwn(daemonFlags, 'json'), false);
  assert.equal(Object.hasOwn(daemonFlags, 'help'), false);
  assert.equal(Object.hasOwn(daemonFlags, 'version'), false);
});

test('parseArgs accepts --save-script with optional path value', () => {
  const withoutPath = parseArgs(['open', 'settings', '--save-script']);
  assert.equal(withoutPath.command, 'open');
  assert.deepEqual(withoutPath.positionals, ['settings']);
  assert.equal(withoutPath.flags.saveScript, true);

  const withPath = parseArgs(['open', 'settings', '--save-script', './workflows/my-flow.ad']);
  assert.equal(withPath.command, 'open');
  assert.deepEqual(withPath.positionals, ['settings']);
  assert.equal(withPath.flags.saveScript, './workflows/my-flow.ad');

  const nonPathPositional = parseArgs(['open', '--save-script', 'settings']);
  assert.equal(nonPathPositional.command, 'open');
  assert.deepEqual(nonPathPositional.positionals, ['settings']);
  assert.equal(nonPathPositional.flags.saveScript, true);

  const inlineValue = parseArgs(['open', 'settings', '--save-script=my-flow.ad']);
  assert.equal(inlineValue.command, 'open');
  assert.deepEqual(inlineValue.positionals, ['settings']);
  assert.equal(inlineValue.flags.saveScript, 'my-flow.ad');

  const ambiguousBareValue = parseArgs(['open', '--save-script', 'my-flow.ad']);
  assert.equal(ambiguousBareValue.command, 'open');
  assert.deepEqual(ambiguousBareValue.positionals, ['my-flow.ad']);
  assert.equal(ambiguousBareValue.flags.saveScript, true);
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

test('parseArgs recognizes press selector + snapshot flags', () => {
  const parsed = parseArgs(['press', '@e2', '--depth', '3', '--scope', 'Sign In', '--raw'], { strictFlags: true });
  assert.equal(parsed.command, 'press');
  assert.deepEqual(parsed.positionals, ['@e2']);
  assert.equal(parsed.flags.snapshotDepth, 3);
  assert.equal(parsed.flags.snapshotScope, 'Sign In');
  assert.equal(parsed.flags.snapshotRaw, true);
});

test('parseArgs recognizes click series flags', () => {
  const parsed = parseArgs(['click', '@e5', '--count', '4', '--interval-ms', '10'], { strictFlags: true });
  assert.equal(parsed.command, 'click');
  assert.deepEqual(parsed.positionals, ['@e5']);
  assert.equal(parsed.flags.count, 4);
  assert.equal(parsed.flags.intervalMs, 10);
});

test('parseArgs recognizes tap batching flag for repeated press', () => {
  const parsed = parseArgs(['press', '201', '545', '--count', '5', '--tap-batch'], { strictFlags: true });
  assert.equal(parsed.command, 'press');
  assert.deepEqual(parsed.positionals, ['201', '545']);
  assert.equal(parsed.flags.count, 5);
  assert.equal(parsed.flags.tapBatch, true);
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
  assert.match(usage(), /--save-script \[path\]/);
  assert.match(usage(), /pinch <scale> \[x\] \[y\]/);
  assert.doesNotMatch(usage(), /--metadata/);
});

test('apps defaults to --all filter and allows overrides', () => {
  const defaultFilter = parseArgs(['apps'], { strictFlags: true });
  assert.equal(defaultFilter.command, 'apps');
  assert.equal(defaultFilter.flags.appsFilter, 'all');

  const userInstalled = parseArgs(['apps', '--user-installed'], { strictFlags: true });
  assert.equal(userInstalled.command, 'apps');
  assert.equal(userInstalled.flags.appsFilter, 'user-installed');
});

test('every capability command has a parser schema entry', () => {
  const schemaCommands = new Set(getCliCommandNames());
  for (const command of listCapabilityCommands()) {
    assert.equal(schemaCommands.has(command), true, `Missing schema for command: ${command}`);
  }
});

test('schema capability mappings match capability source-of-truth', () => {
  assert.deepEqual(getSchemaCapabilityKeys(), listCapabilityCommands());
});

test('compat mode warns and strips unsupported command flags', () => {
  const parsed = parseArgs(['press', '10', '20', '--pause-ms', '2'], { strictFlags: false });
  assert.equal(parsed.command, 'press');
  assert.equal(parsed.flags.pauseMs, undefined);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /not supported for command press/);
});

test('strict mode rejects unsupported pilot-command flags', () => {
  assert.throws(
    () => parseArgs(['press', '10', '20', '--pause-ms', '2'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('not supported for command press'),
  );
});

test('snapshot command accepts command-specific flags', () => {
  const parsed = parseArgs(['snapshot', '-i', '-c', '--depth', '3', '-s', 'Login'], { strictFlags: true });
  assert.equal(parsed.command, 'snapshot');
  assert.equal(parsed.flags.snapshotInteractiveOnly, true);
  assert.equal(parsed.flags.snapshotCompact, true);
  assert.equal(parsed.flags.snapshotDepth, 3);
  assert.equal(parsed.flags.snapshotScope, 'Login');
});

test('unknown short flags are rejected', () => {
  assert.throws(
    () => parseArgs(['press', '10', '20', '-x'], { strictFlags: true }),
    (error) => error instanceof AppError && error.code === 'INVALID_ARGS' && error.message === 'Unknown flag: -x',
  );
});

test('negative numeric positionals are accepted without -- separator', () => {
  const typed = parseArgs(['type', '-123'], { strictFlags: true });
  assert.equal(typed.command, 'type');
  assert.deepEqual(typed.positionals, ['-123']);

  const typedMulti = parseArgs(['type', '-123', '-456'], { strictFlags: true });
  assert.equal(typedMulti.command, 'type');
  assert.deepEqual(typedMulti.positionals, ['-123', '-456']);

  const pressed = parseArgs(['press', '-10', '20'], { strictFlags: true });
  assert.equal(pressed.command, 'press');
  assert.deepEqual(pressed.positionals, ['-10', '20']);
});

test('command-specific flags without command fail in strict mode', () => {
  assert.throws(
    () => parseArgs(['--depth', '3'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('requires a command that supports it'),
  );
});

test('command-specific flags without command warn and strip in compat mode', () => {
  const parsed = parseArgs(['--depth', '3'], { strictFlags: false });
  assert.equal(parsed.command, null);
  assert.equal(parsed.flags.snapshotDepth, undefined);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /requires a command that supports/);
});

test('all commands participate in strict command-flag validation', () => {
  assert.throws(
    () => parseArgs(['open', 'Settings', '--depth', '1'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('not supported for command open'),
  );
});

test('invalid range errors are deterministic', () => {
  assert.throws(
    () => parseArgs(['snapshot', '--backend', 'xctest'], { strictFlags: true }),
    (error) =>
      error instanceof AppError && error.code === 'INVALID_ARGS' && error.message === 'Unknown flag: --backend',
  );
  assert.throws(
    () => parseArgs(['snapshot', '--depth', '-1'], { strictFlags: true }),
    (error) => error instanceof AppError && error.code === 'INVALID_ARGS' && error.message === 'Invalid depth: -1',
  );
});

test('usage includes swipe and press series options', () => {
  const help = usage();
  assert.match(help, /swipe <x1> <y1> <x2> <y2>/);
  assert.match(help, /--pattern one-way\|ping-pong/);
  assert.match(help, /--interval-ms/);
});

test('command usage shows command and global flags separately', () => {
  const help = usageForCommand('swipe');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /Swipe coordinates with optional repeat pattern/);
  assert.match(help, /Command flags:/);
  assert.match(help, /--pattern one-way\|ping-pong/);
  assert.match(help, /Global flags:/);
  assert.match(help, /--platform ios\|android/);
});

test('command usage shows no command flags when unsupported', () => {
  const help = usageForCommand('appstate');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /Show foreground app\/activity/);
  assert.doesNotMatch(help, /Command flags:/);
  assert.match(help, /Global flags:/);
});
