import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildBundleUrl, normalizeBaseUrl } from '../metro.ts';

test('public metro exports expose stable url helpers', () => {
  assert.equal(normalizeBaseUrl('https://bridge.example.test///'), 'https://bridge.example.test');
  assert.equal(
    buildBundleUrl('https://bridge.example.test/', 'ios'),
    'https://bridge.example.test/index.bundle?platform=ios&dev=true&minify=false',
  );
});
