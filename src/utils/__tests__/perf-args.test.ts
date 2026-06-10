import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseArgs, usageForCommand } from '../args.ts';

test('parseArgs accepts perf area subcommands', () => {
  const metrics = parseArgs(['perf', 'metrics'], { strictFlags: true });
  assert.equal(metrics.command, 'perf');
  assert.deepEqual(metrics.positionals, ['metrics']);

  const frames = parseArgs(['perf', 'frames'], { strictFlags: true });
  assert.equal(frames.command, 'perf');
  assert.deepEqual(frames.positionals, ['frames']);

  const memory = parseArgs(['perf', 'memory', 'snapshot', '--kind', 'memgraph'], {
    strictFlags: true,
  });
  assert.equal(memory.command, 'perf');
  assert.deepEqual(memory.positionals, ['memory', 'snapshot']);
  assert.equal(memory.flags.kind, 'memgraph');
});

test('usageForCommand advertises perf area subcommands for metrics alias', () => {
  const help = usageForCommand('metrics');
  assert.equal(help === null, false);
  assert.match(help ?? '', /agent-device perf \[metrics\|frames\|memory\]/);
  assert.match(help ?? '', /perf memory snapshot/);
});
