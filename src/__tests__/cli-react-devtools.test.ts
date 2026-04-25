import fs from 'node:fs';
import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../utils/exec.ts', () => ({
  runCmdStreaming: vi.fn(),
}));

vi.mock('../client-metro-companion.ts', () => ({
  ensureMetroCompanion: vi.fn(),
  stopMetroCompanion: vi.fn(),
}));

import { runCmdStreaming } from '../utils/exec.ts';
import { ensureMetroCompanion, stopMetroCompanion } from '../client-metro-companion.ts';
import {
  AGENT_REACT_DEVTOOLS_PACKAGE,
  buildReactDevtoolsNpmExecArgs,
  runReactDevtoolsCommand,
} from '../cli/commands/react-devtools.ts';

afterEach(() => {
  vi.clearAllMocks();
});

test('react-devtools passthrough pins agent-react-devtools package version', () => {
  assert.equal(AGENT_REACT_DEVTOOLS_PACKAGE, 'agent-react-devtools@0.4.0');
  assert.deepEqual(buildReactDevtoolsNpmExecArgs(['get', 'tree', '--depth', '3']), [
    'exec',
    '--yes',
    '--package',
    'agent-react-devtools@0.4.0',
    '--',
    'agent-react-devtools',
    'get',
    'tree',
    '--depth',
    '3',
  ]);
});

test('react-devtools docs mention the pinned package version', () => {
  const docs = ['README.md', 'website/docs/docs/commands.md', 'skills/react-devtools/SKILL.md'];

  for (const file of docs) {
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(AGENT_REACT_DEVTOOLS_PACKAGE));
  }
});

test('react-devtools starts remote Android companion around passthrough command', async () => {
  const env = { ...process.env };
  vi.mocked(runCmdStreaming).mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
  });
  vi.mocked(ensureMetroCompanion).mockResolvedValueOnce({
    pid: 123,
    spawned: true,
    statePath: '/tmp/state.json',
    logPath: '/tmp/companion.log',
  });
  vi.mocked(stopMetroCompanion).mockResolvedValueOnce({
    stopped: true,
    statePath: '/tmp/state.json',
  });

  const exitCode = await runReactDevtoolsCommand(['status'], {
    stateDir: '/tmp/agent-device-state',
    session: 'default',
    cwd: '/tmp/project',
    env,
    flags: {
      platform: 'android',
      leaseBackend: 'android-instance',
      metroProxyBaseUrl: 'https://bridge.example.test',
      metroBearerToken: 'token',
      tenant: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
      remoteConfig: '/tmp/remote.json',
      session: 'default',
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(vi.mocked(ensureMetroCompanion).mock.calls.length, 1);
  assert.deepEqual(vi.mocked(ensureMetroCompanion).mock.calls[0]?.[0], {
    projectRoot: '/tmp/project',
    stateDir: '/tmp/agent-device-state',
    kind: 'react-devtools',
    serverBaseUrl: 'https://bridge.example.test',
    bearerToken: 'token',
    localBaseUrl: 'http://127.0.0.1:8097',
    bridgeScope: {
      tenantId: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
    },
    registerPath: '/api/react-devtools/companion/register',
    unregisterPath: '/api/react-devtools/companion/unregister',
    devicePort: 8097,
    session: 'default',
    profileKey: '/tmp/remote.json',
    consumerKey: 'default',
    env,
  });
  assert.equal(vi.mocked(runCmdStreaming).mock.calls[0]?.[0], 'npm');
  assert.equal(vi.mocked(runCmdStreaming).mock.calls[0]?.[2]?.cwd, '/tmp/project');
  assert.equal(vi.mocked(runCmdStreaming).mock.calls[0]?.[2]?.env, env);
  assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 1);
  assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
    projectRoot: '/tmp/project',
    stateDir: '/tmp/agent-device-state',
    kind: 'react-devtools',
    profileKey: '/tmp/remote.json',
    consumerKey: 'default',
  });
});

test('react-devtools skips companion for non-Android remote sessions', async () => {
  vi.mocked(runCmdStreaming).mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
  });

  await runReactDevtoolsCommand(['status'], {
    stateDir: '/tmp/agent-device-state',
    session: 'default',
    flags: {
      platform: 'ios',
      metroProxyBaseUrl: 'https://bridge.example.test',
      metroBearerToken: 'token',
      tenant: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
    },
  });

  assert.equal(vi.mocked(ensureMetroCompanion).mock.calls.length, 0);
  assert.equal(vi.mocked(stopMetroCompanion).mock.calls.length, 0);
});

test('react-devtools fails clearly when remote Android bridge scope is incomplete', async () => {
  await assert.rejects(
    () =>
      runReactDevtoolsCommand(['status'], {
        stateDir: '/tmp/agent-device-state',
        session: 'default',
        flags: {
          platform: 'android',
          leaseBackend: 'android-instance',
          metroProxyBaseUrl: 'https://bridge.example.test',
          tenant: 'tenant-1',
          runId: 'run-1',
          leaseId: 'lease-1',
        },
      }),
    /react-devtools remote Android bridge requires metroBearerToken/,
  );

  assert.equal(vi.mocked(runCmdStreaming).mock.calls.length, 0);
  assert.equal(vi.mocked(ensureMetroCompanion).mock.calls.length, 0);
});
