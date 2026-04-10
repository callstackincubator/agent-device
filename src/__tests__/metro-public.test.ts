import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../client-metro.ts', async () => {
  const actual = await vi.importActual<typeof import('../client-metro.ts')>('../client-metro.ts');
  return {
    ...actual,
    prepareMetroRuntime: vi.fn(),
  };
});

vi.mock('../client-metro-companion.ts', () => ({
  ensureMetroCompanion: vi.fn(),
  stopMetroCompanion: vi.fn(),
}));

import { prepareMetroRuntime } from '../client-metro.ts';
import { ensureMetroCompanion, stopMetroCompanion } from '../client-metro-companion.ts';
import {
  buildAndroidRuntimeHints,
  buildIosRuntimeHints,
  ensureMetroTunnel,
  prepareRemoteMetro,
  stopMetroTunnel,
} from '../metro.ts';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test('public metro helpers expose stable Node-facing wrappers', async () => {
  vi.mocked(prepareMetroRuntime).mockResolvedValue({
    projectRoot: '/tmp/project',
    kind: 'react-native',
    dependenciesInstalled: false,
    packageManager: null,
    started: false,
    reused: true,
    pid: 0,
    logPath: '/tmp/project/.agent-device/metro.log',
    statusUrl: 'http://127.0.0.1:8081/status',
    runtimeFilePath: null,
    iosRuntime: { platform: 'ios', bundleUrl: 'https://ios.example.test/index.bundle' },
    androidRuntime: {
      platform: 'android',
      bundleUrl: 'https://android.example.test/index.bundle',
    },
    bridge: null,
  });
  vi.mocked(ensureMetroCompanion).mockResolvedValue({
    pid: 123,
    spawned: true,
    statePath: '/tmp/project/.agent-device/metro-companion.json',
    logPath: '/tmp/project/.agent-device/metro-companion.log',
  });
  vi.mocked(stopMetroCompanion).mockResolvedValue({
    stopped: true,
    statePath: '/tmp/project/.agent-device/metro-companion.json',
  });

  const prepared = await prepareRemoteMetro({
    projectRoot: '/tmp/project',
    kind: 'react-native',
    publicBaseUrl: 'https://public.example.test',
    proxyBaseUrl: 'https://proxy.example.test',
    proxyBearerToken: 'token',
    profileKey: '/tmp/profile.remote.json',
    consumerKey: 'session-a',
    port: 8081,
  });
  const tunnel = await ensureMetroTunnel({
    projectRoot: '/tmp/project',
    serverBaseUrl: 'https://proxy.example.test',
    bearerToken: 'token',
    localBaseUrl: 'http://127.0.0.1:8081',
  });
  await stopMetroTunnel({
    projectRoot: '/tmp/project',
  });

  assert.equal(prepared.reused, true);
  assert.equal(prepared.logPath, '/tmp/project/.agent-device/metro.log');
  assert.equal(tunnel.started, true);
  assert.equal(tunnel.logPath, '/tmp/project/.agent-device/metro-companion.log');
  assert.deepEqual(vi.mocked(prepareMetroRuntime).mock.calls[0]?.[0], {
    projectRoot: '/tmp/project',
    kind: 'react-native',
    publicBaseUrl: 'https://public.example.test',
    proxyBaseUrl: 'https://proxy.example.test',
    proxyBearerToken: 'token',
    launchUrl: undefined,
    companionProfileKey: '/tmp/profile.remote.json',
    companionConsumerKey: 'session-a',
    metroPort: 8081,
    listenHost: undefined,
    statusHost: undefined,
    startupTimeoutMs: undefined,
    probeTimeoutMs: undefined,
    reuseExisting: undefined,
    installDependenciesIfNeeded: undefined,
    runtimeFilePath: undefined,
    logPath: undefined,
    env: undefined,
  });
  assert.equal(
    buildIosRuntimeHints('https://public.example.test').bundleUrl,
    'https://public.example.test/index.bundle?platform=ios&dev=true&minify=false',
  );
  assert.equal(
    buildAndroidRuntimeHints('https://public.example.test').bundleUrl,
    'https://public.example.test/index.bundle?platform=android&dev=true&minify=false',
  );
});
