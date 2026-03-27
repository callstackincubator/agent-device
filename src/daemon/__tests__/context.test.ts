import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CommandFlags } from '../../core/dispatch.ts';
import { contextFromFlags } from '../context.ts';

test('contextFromFlags propagates back mode into the dispatch context', () => {
  const context = contextFromFlags('/tmp/agent-device.log', { backMode: 'system' });
  assert.equal(context.backMode, 'system');
});

test('contextFromFlags forwards scroll pixels from CLI flags', () => {
  const flags: CommandFlags = { pixels: 240 };
  const context = contextFromFlags('/tmp/agent-device.log', flags);
  assert.equal(context.pixels, 240);
});
