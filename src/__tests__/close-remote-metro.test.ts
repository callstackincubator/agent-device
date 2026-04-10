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

    const client: AgentDeviceClient = {
      devices: { list: async () => [] },
      sessions: {
        list: async () => [],
        close: async () => ({
          session: 'adc-android',
          identifiers: { session: 'adc-android' },
        }),
      },
      simulators: {
        ensure: async () => {
          throw new Error('unexpected call');
        },
      },
      apps: {
        install: async () => {
          throw new Error('unexpected call');
        },
        reinstall: async () => {
          throw new Error('unexpected call');
        },
        installFromSource: async () => {
          throw new Error('unexpected call');
        },
        open: async () => {
          throw new Error('unexpected call');
        },
        close: async () => {
          throw new Error('unexpected call');
        },
      },
      materializations: {
        release: async () => {
          throw new Error('unexpected call');
        },
      },
      metro: {
        prepare: async () => {
          throw new Error('unexpected call');
        },
      },
      capture: {
        snapshot: async () => {
          throw new Error('unexpected call');
        },
        screenshot: async () => {
          throw new Error('unexpected call');
        },
      },
    };

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

    const client: AgentDeviceClient = {
      devices: { list: async () => [] },
      sessions: {
        list: async () => [],
        close: async () => {
          throw new Error('session close failed');
        },
      },
      simulators: {
        ensure: async () => {
          throw new Error('unexpected call');
        },
      },
      apps: {
        install: async () => {
          throw new Error('unexpected call');
        },
        reinstall: async () => {
          throw new Error('unexpected call');
        },
        installFromSource: async () => {
          throw new Error('unexpected call');
        },
        open: async () => {
          throw new Error('unexpected call');
        },
        close: async () => {
          throw new Error('unexpected call');
        },
      },
      materializations: {
        release: async () => {
          throw new Error('unexpected call');
        },
      },
      metro: {
        prepare: async () => {
          throw new Error('unexpected call');
        },
      },
      capture: {
        snapshot: async () => {
          throw new Error('unexpected call');
        },
        screenshot: async () => {
          throw new Error('unexpected call');
        },
      },
    };

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

test('close app with remote-config does not stop the managed Metro companion', async () => {
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

    const client: AgentDeviceClient = {
      devices: { list: async () => [] },
      sessions: {
        list: async () => [],
        close: async () => {
          throw new Error('unexpected call');
        },
      },
      simulators: {
        ensure: async () => {
          throw new Error('unexpected call');
        },
      },
      apps: {
        install: async () => {
          throw new Error('unexpected call');
        },
        reinstall: async () => {
          throw new Error('unexpected call');
        },
        installFromSource: async () => {
          throw new Error('unexpected call');
        },
        open: async () => {
          throw new Error('unexpected call');
        },
        close: async () => ({
          session: 'adc-android',
          identifiers: { session: 'adc-android' },
        }),
      },
      materializations: {
        release: async () => {
          throw new Error('unexpected call');
        },
      },
      metro: {
        prepare: async () => {
          throw new Error('unexpected call');
        },
      },
      capture: {
        snapshot: async () => {
          throw new Error('unexpected call');
        },
        screenshot: async () => {
          throw new Error('unexpected call');
        },
      },
    };

    const handled = await closeCommand({
      positionals: ['com.example.demo'],
      flags: { ...parsed.flags, json: true, shutdown: true },
      client,
    });

    assert.equal(handled, true);
    assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
