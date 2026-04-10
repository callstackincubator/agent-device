import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildBundleUrl,
  normalizeBaseUrl,
  type MetroBridgeDescriptor,
  type MetroTunnelRequestMessage,
  type MetroTunnelResponseMessage,
} from '../metro.ts';

test('public metro protocol helpers expose stable bridge payload types and url helpers', () => {
  const descriptor: MetroBridgeDescriptor = {
    enabled: true,
    base_url: 'https://bridge.example.test',
    status_url: 'https://bridge.example.test/status',
    bundle_url: 'https://bridge.example.test/index.bundle?platform=ios',
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
      host: '127.0.0.1',
      port: 8081,
      status_url: 'http://127.0.0.1:8081/status',
    },
    probe: {
      reachable: true,
      status_code: 200,
      latency_ms: 4,
      detail: 'ok',
    },
  };

  assert.equal(descriptor.upstream.port, 8081);
  assert.equal(normalizeBaseUrl('https://bridge.example.test///'), 'https://bridge.example.test');
  assert.equal(
    buildBundleUrl('https://bridge.example.test/', 'ios'),
    'https://bridge.example.test/index.bundle?platform=ios&dev=true&minify=false',
  );
});

test('public metro protocol exports stable tunnel message types', () => {
  const request: MetroTunnelRequestMessage = {
    type: 'ws-frame',
    streamId: 'stream-1',
    dataBase64: 'aGVsbG8=',
    binary: false,
  };
  const response: MetroTunnelResponseMessage = {
    type: 'http-response',
    requestId: 'req-1',
    status: 200,
    headers: { 'content-type': 'application/json' },
  };

  assert.equal(request.type, 'ws-frame');
  assert.equal(response.type, 'http-response');
});
