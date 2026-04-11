import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildBundleUrl,
  normalizeBaseUrl,
  type MetroBridgeDescriptor,
} from '../metro.ts';

test('public metro exports expose stable bridge payload types and url helpers', () => {
  const descriptor: MetroBridgeDescriptor = {
    enabled: true,
    base_url: 'https://bridge.example.test',
    ios_runtime: {
      metro_host: '127.0.0.1',
      metro_port: 8081,
      metro_bundle_url: 'https://bridge.example.test/index.bundle?platform=ios',
    },
    android_runtime: {
      metro_host: '10.0.2.2',
      metro_port: 8081,
      metro_bundle_url: 'https://bridge.example.test/index.bundle?platform=android',
    },
    upstream: {
      bundle_url: 'http://127.0.0.1:8081/index.bundle?platform=ios',
    },
    probe: {
      reachable: true,
      status_code: 200,
      latency_ms: 4,
      detail: 'ok',
    },
  };

  assert.equal(normalizeBaseUrl('https://bridge.example.test///'), 'https://bridge.example.test');
  assert.equal(
    buildBundleUrl('https://bridge.example.test/', 'ios'),
    'https://bridge.example.test/index.bundle?platform=ios&dev=true&minify=false',
  );
});
