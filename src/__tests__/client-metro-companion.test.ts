import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../utils/exec.ts', () => ({
  runCmdDetached: vi.fn(),
}));

vi.mock('../utils/process-identity.ts', () => ({
  isProcessAlive: vi.fn(),
  readProcessCommand: vi.fn(),
  readProcessStartTime: vi.fn(),
  waitForProcessExit: vi.fn(),
}));

import { runCmdDetached } from '../utils/exec.ts';
import {
  isProcessAlive,
  readProcessCommand,
  readProcessStartTime,
  waitForProcessExit,
} from '../utils/process-identity.ts';
import { ensureMetroCompanion, stopMetroCompanion } from '../client-metro-companion.ts';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test('companion ownership is profile-scoped and consumer-counted', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-metro-companion-state-'));
  try {
    vi.mocked(runCmdDetached).mockReturnValueOnce(111).mockReturnValueOnce(222);
    vi.mocked(isProcessAlive).mockReturnValue(true);
    vi.mocked(readProcessStartTime).mockImplementation((pid) =>
      pid === 111 ? 'start-111' : 'start-222',
    );
    vi.mocked(readProcessCommand).mockImplementation(
      () => `${process.execPath} src/client-metro-companion.ts --agent-device-run-metro-companion`,
    );
    vi.mocked(waitForProcessExit).mockResolvedValue(true);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const stagingFirst = await ensureMetroCompanion({
      projectRoot,
      serverBaseUrl: 'https://bridge.example.test',
      bearerToken: 'token',
      localBaseUrl: 'http://127.0.0.1:8081',
      launchUrl: 'myapp://staging',
      profileKey: '/tmp/staging.json',
      consumerKey: 'session-a',
    });
    const stagingSecond = await ensureMetroCompanion({
      projectRoot,
      serverBaseUrl: 'https://bridge.example.test',
      bearerToken: 'token',
      localBaseUrl: 'http://127.0.0.1:8081',
      launchUrl: 'myapp://staging',
      profileKey: '/tmp/staging.json',
      consumerKey: 'session-b',
    });
    const prod = await ensureMetroCompanion({
      projectRoot,
      serverBaseUrl: 'https://bridge.example.test',
      bearerToken: 'token',
      localBaseUrl: 'http://127.0.0.1:8081',
      launchUrl: 'myapp://prod',
      profileKey: '/tmp/prod.json',
      consumerKey: 'session-prod',
    });

    assert.equal(stagingFirst.spawned, true);
    assert.equal(stagingSecond.spawned, false);
    assert.notEqual(stagingFirst.statePath, prod.statePath);
    assert.equal(vi.mocked(runCmdDetached).mock.calls.length, 2);

    const stagingState = JSON.parse(fs.readFileSync(stagingFirst.statePath, 'utf8')) as {
      consumers: string[];
    };
    assert.deepEqual(stagingState.consumers.sort(), ['session-a', 'session-b']);

    const partialStop = await stopMetroCompanion({
      projectRoot,
      profileKey: '/tmp/staging.json',
      consumerKey: 'session-a',
    });
    assert.equal(partialStop.stopped, false);
    assert.equal(killSpy.mock.calls.length, 0);

    const remainingState = JSON.parse(fs.readFileSync(stagingFirst.statePath, 'utf8')) as {
      consumers: string[];
    };
    assert.deepEqual(remainingState.consumers, ['session-b']);

    const finalStop = await stopMetroCompanion({
      projectRoot,
      profileKey: '/tmp/staging.json',
      consumerKey: 'session-b',
    });
    assert.equal(finalStop.stopped, true);
    assert.equal(killSpy.mock.calls.length, 1);
    assert.deepEqual(killSpy.mock.calls[0], [111, 'SIGTERM']);

    const prodStop = await stopMetroCompanion({
      projectRoot,
      profileKey: '/tmp/prod.json',
      consumerKey: 'session-prod',
    });
    assert.equal(prodStop.stopped, true);
    assert.equal(killSpy.mock.calls.length, 2);
    assert.deepEqual(killSpy.mock.calls[1], [222, 'SIGTERM']);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('launchUrl changes force a companion respawn for the same profile', async () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-device-metro-companion-launch-'),
  );
  try {
    vi.mocked(runCmdDetached).mockReturnValueOnce(333).mockReturnValueOnce(444);
    vi.mocked(isProcessAlive).mockReturnValue(true);
    vi.mocked(readProcessStartTime).mockImplementation((pid) =>
      pid === 333 ? 'start-333' : 'start-444',
    );
    vi.mocked(readProcessCommand).mockImplementation(
      () => `${process.execPath} src/client-metro-companion.ts --agent-device-run-metro-companion`,
    );
    vi.mocked(waitForProcessExit).mockResolvedValue(true);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const first = await ensureMetroCompanion({
      projectRoot,
      serverBaseUrl: 'https://bridge.example.test',
      bearerToken: 'token',
      localBaseUrl: 'http://127.0.0.1:8081',
      launchUrl: 'myapp://first',
      profileKey: '/tmp/profile.json',
      consumerKey: 'session-a',
    });
    const second = await ensureMetroCompanion({
      projectRoot,
      serverBaseUrl: 'https://bridge.example.test',
      bearerToken: 'token',
      localBaseUrl: 'http://127.0.0.1:8081',
      launchUrl: 'myapp://second',
      profileKey: '/tmp/profile.json',
      consumerKey: 'session-a',
    });

    assert.equal(first.spawned, true);
    assert.equal(second.spawned, true);
    assert.equal(vi.mocked(runCmdDetached).mock.calls.length, 2);
    assert.equal(killSpy.mock.calls.length, 1);
    assert.deepEqual(killSpy.mock.calls[0], [333, 'SIGTERM']);

    const state = JSON.parse(fs.readFileSync(second.statePath, 'utf8')) as {
      launchUrl?: string;
    };
    assert.equal(state.launchUrl, 'myapp://second');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
