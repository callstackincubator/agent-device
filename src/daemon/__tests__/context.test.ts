import test from 'node:test';
import assert from 'node:assert/strict';
import { contextFromFlags } from '../context.ts';

test('contextFromFlags propagates back mode into the dispatch context', () => {
  const context = contextFromFlags('/tmp/agent-device.log', { backMode: 'system' });
  assert.equal(context.backMode, 'system');
});
