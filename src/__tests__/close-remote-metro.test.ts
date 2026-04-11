import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../client-metro-companion.ts', () => ({
  stopMetroCompanion: vi.fn(),
}));

import { closeCommand } from '../cli/commands/open.ts';
import { stopMetroCompanion } from '../client-metro-companion.ts';
import type { AgentDeviceClient } from '../client.ts';
import { resolveCliOptions } from '../utils/cli-options.ts';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const unexpectedCommandCall = async (): Promise<never> => {
  throw new Error('unexpected call');
};

function createThrowingMethodGroup<T extends object>(methods: Partial<T> = {}): T {
  return new Proxy(methods, {
    get: (target, property) => target[property as keyof T] ?? unexpectedCommandCall,
  }) as T;
}

function createTestClient(groups: Partial<AgentDeviceClient> = {}): AgentDeviceClient {
  return {
    command: createThrowingMethodGroup<AgentDeviceClient['command']>(),
    devices: createThrowingMethodGroup<AgentDeviceClient['devices']>(),
    sessions: createThrowingMethodGroup<AgentDeviceClient['sessions']>(),
    simulators: createThrowingMethodGroup<AgentDeviceClient['simulators']>(),
    apps: createThrowingMethodGroup<AgentDeviceClient['apps']>(),
    materializations: createThrowingMethodGroup<AgentDeviceClient['materializations']>(),
    metro: createThrowingMethodGroup<AgentDeviceClient['metro']>(),
    capture: createThrowingMethodGroup<AgentDeviceClient['capture']>(),
    interactions: createThrowingMethodGroup<AgentDeviceClient['interactions']>(),
    replay: createThrowingMethodGroup<AgentDeviceClient['replay']>(),
    batch: createThrowingMethodGroup<AgentDeviceClient['batch']>(),
    observability: createThrowingMethodGroup<AgentDeviceClient['observability']>(),
    recording: createThrowingMethodGroup<AgentDeviceClient['recording']>(),
    settings: createThrowingMethodGroup<AgentDeviceClient['settings']>(),
    ...groups,
  };
}

test('close with remote-config stops the managed Metro companion for that project', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-close-remote-metro-'));
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  try {
    fs.writeFileSync(
      remoteConfigPath,
      JSON.stringify({
        daemonBaseUrl: 'https://daemon.example.test/agent-device',
        session: 'adc-android',
        platform: 'android',
        metroProjectRoot: '/tmp/project',
        metroProxyBaseUrl: 'https://proxy.example.test',
      }),
    );
    const parsed = resolveCliOptions(['close', '--remote-config', remoteConfigPath], {
      cwd: tempRoot,
      env: process.env,
    });

    const client = createTestClient({
      sessions: createThrowingMethodGroup<AgentDeviceClient['sessions']>({
        close: async () => ({
          session: 'adc-android',
          identifiers: { session: 'adc-android' },
        }),
      }),
    });

    vi.mocked(stopMetroCompanion).mockResolvedValue({
      stopped: true,
      statePath: '/tmp/project/.agent-device/metro-companion.json',
    });

    const handled = await closeCommand({
      positionals: [],
      flags: { ...parsed.flags, json: true, shutdown: true },
      client,
    });

    assert.equal(handled, true);
    assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 1);
    assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
      projectRoot: '/tmp/project',
      profileKey: remoteConfigPath,
      consumerKey: 'adc-android',
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('close with remote-config still stops the managed Metro companion when close fails', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-close-remote-metro-fail-'));
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  try {
    fs.writeFileSync(
      remoteConfigPath,
      JSON.stringify({
        daemonBaseUrl: 'https://daemon.example.test/agent-device',
        session: 'adc-android',
        platform: 'android',
        metroProjectRoot: '/tmp/project',
        metroProxyBaseUrl: 'https://proxy.example.test',
      }),
    );
    const parsed = resolveCliOptions(['close', '--remote-config', remoteConfigPath], {
      cwd: tempRoot,
      env: process.env,
    });

    const client = createTestClient({
      sessions: createThrowingMethodGroup<AgentDeviceClient['sessions']>({
        close: async () => {
          throw new Error('session close failed');
        },
      }),
    });

    vi.mocked(stopMetroCompanion).mockResolvedValue({
      stopped: true,
      statePath: '/tmp/project/.agent-device/metro-companion.json',
    });

    await assert.rejects(
      () =>
        closeCommand({
          positionals: [],
          flags: { ...parsed.flags, json: true, shutdown: true },
          client,
        }),
      /session close failed/,
    );

    assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 1);
    assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
      projectRoot: '/tmp/project',
      profileKey: remoteConfigPath,
      consumerKey: 'adc-android',
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('close app with remote-config stops the managed Metro companion for that session', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-close-app-remote-metro-'));
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  try {
    fs.writeFileSync(
      remoteConfigPath,
      JSON.stringify({
        daemonBaseUrl: 'https://daemon.example.test/agent-device',
        session: 'adc-android',
        platform: 'android',
        metroProjectRoot: '/tmp/project',
        metroProxyBaseUrl: 'https://proxy.example.test',
      }),
    );
    const parsed = resolveCliOptions(
      ['close', 'com.example.demo', '--remote-config', remoteConfigPath],
      {
        cwd: tempRoot,
        env: process.env,
      },
    );

    const client = createTestClient({
      apps: createThrowingMethodGroup<AgentDeviceClient['apps']>({
        close: async () => ({
          session: 'adc-android',
          identifiers: { session: 'adc-android' },
        }),
      }),
    });

    vi.mocked(stopMetroCompanion).mockResolvedValue({
      stopped: true,
      statePath: '/tmp/project/.agent-device/metro-companion.json',
    });

    const handled = await closeCommand({
      positionals: ['com.example.demo'],
      flags: { ...parsed.flags, json: true, shutdown: true },
      client,
    });

    assert.equal(handled, true);
    assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 1);
    assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
      projectRoot: '/tmp/project',
      profileKey: remoteConfigPath,
      consumerKey: 'adc-android',
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('close with remote-config still succeeds when the config file is gone before cleanup', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-device-close-remote-metro-missing-config-'),
  );
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  try {
    fs.writeFileSync(
      remoteConfigPath,
      JSON.stringify({
        daemonBaseUrl: 'https://daemon.example.test/agent-device',
        session: 'adc-android',
        platform: 'android',
        metroProjectRoot: '/tmp/project',
        metroProxyBaseUrl: 'https://proxy.example.test',
      }),
    );
    const parsed = resolveCliOptions(['close', '--remote-config', remoteConfigPath], {
      cwd: tempRoot,
      env: process.env,
    });
    fs.rmSync(remoteConfigPath);

    const client = createTestClient({
      sessions: createThrowingMethodGroup<AgentDeviceClient['sessions']>({
        close: async () => ({
          session: 'adc-android',
          identifiers: { session: 'adc-android' },
        }),
      }),
    });

    const handled = await closeCommand({
      positionals: [],
      flags: { ...parsed.flags, json: true, shutdown: true },
      client,
    });

    assert.equal(handled, true);
    assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
