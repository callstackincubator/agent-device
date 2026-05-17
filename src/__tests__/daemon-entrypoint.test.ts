import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { resolveDaemonPaths } from '../daemon/config.ts';
import { runCmdBackground } from '../utils/exec.ts';
import { isProcessAlive, waitForProcessExit } from '../utils/process-identity.ts';
import { waitForHttpOk } from './test-utils/index.ts';

type DaemonInfoFile = {
  httpPort?: number;
  token?: string;
  pid?: number;
};

function waitForStdoutLine(
  stream: NodeJS.ReadableStream | null,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  if (!stream) {
    return Promise.reject(new Error('Expected daemon stdout stream.'));
  }
  stream.setEncoding('utf8');
  let buffer = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for daemon stdout line matching ${pattern}.`));
    }, timeoutMs);
    const onData = (chunk: string) => {
      buffer += chunk;
      const line = buffer
        .split('\n')
        .map((entry) => entry.trim())
        .find((entry) => pattern.test(entry));
      if (!line) return;
      cleanup();
      resolve(line);
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off('data', onData);
      stream.off('error', onError);
    };
    stream.on('data', onData);
    stream.on('error', onError);
  });
}

test('daemon entrypoint publishes HTTP metadata and cleans up on shutdown', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-daemon-entrypoint-'));
  const paths = resolveDaemonPaths(stateDir);
  const daemon = runCmdBackground(
    process.execPath,
    ['--experimental-strip-types', 'src/daemon.ts'],
    {
      env: {
        ...process.env,
        AGENT_DEVICE_STATE_DIR: stateDir,
        AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
      },
      allowFailure: true,
    },
  );
  const pid = daemon.child.pid;
  assert.ok(pid, 'daemon process should have a pid');

  try {
    const portLine = await waitForStdoutLine(
      daemon.child.stdout,
      /^AGENT_DEVICE_DAEMON_HTTP_PORT=\d+$/,
      5_000,
    );
    const httpPort = Number(portLine.split('=')[1]);
    const info = JSON.parse(fs.readFileSync(paths.infoPath, 'utf8')) as DaemonInfoFile;

    assert.equal(info.httpPort, httpPort);
    assert.equal(info.pid, pid);
    assert.equal(typeof info.token, 'string');
    assert.ok(fs.existsSync(paths.lockPath), 'daemon lock should be held while running');

    await waitForHttpOk(`http://127.0.0.1:${httpPort}/health`, 2_000);

    daemon.child.kill('SIGTERM');
    const exited = await waitForProcessExit(pid, 5_000);
    assert.equal(exited, true);
    assert.equal(fs.existsSync(paths.infoPath), false);
    assert.equal(fs.existsSync(paths.lockPath), false);
  } finally {
    if (isProcessAlive(pid)) {
      daemon.child.kill('SIGKILL');
      await waitForProcessExit(pid, 2_000);
    }
    await daemon.wait.catch(() => {});
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
