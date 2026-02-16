import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolveDaemonRequestTimeoutMs } from '../../daemon-client.ts';
import {
  isProcessAlive,
  readProcessCommand,
  stopProcessForTakeover,
  waitForProcessExit,
} from '../process-identity.ts';

test('resolveDaemonRequestTimeoutMs defaults to 180000', () => {
  assert.equal(resolveDaemonRequestTimeoutMs(undefined), 180000);
});

test('resolveDaemonRequestTimeoutMs enforces minimum timeout', () => {
  assert.equal(resolveDaemonRequestTimeoutMs('100'), 1000);
  assert.equal(resolveDaemonRequestTimeoutMs('2500'), 2500);
  assert.equal(resolveDaemonRequestTimeoutMs('invalid'), 180000);
});

test('stopDaemonProcessForTakeover terminates a matching daemon process', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // agent-device daemon.js'], {
    stdio: 'ignore',
  });
  const pid = child.pid;
  assert.ok(pid, 'spawned child should have a pid');

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (readProcessCommand(pid) === null) {
      t.skip('process command inspection is unavailable in this environment');
      return;
    }
    assert.equal(isProcessAlive(pid), true);
    await stopProcessForTakeover(pid, {
      termTimeoutMs: 1_500,
      killTimeoutMs: 1_500,
    });
    const exited = await waitForProcessExit(pid, 1500);
    assert.equal(exited, true);
  } finally {
    if (isProcessAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
});

test('stopDaemonProcessForTakeover does not terminate non-daemon process', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  const pid = child.pid;
  assert.ok(pid, 'spawned child should have a pid');

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(isProcessAlive(pid), true);
    await stopProcessForTakeover(pid, {
      termTimeoutMs: 100,
      killTimeoutMs: 100,
    });
    assert.equal(isProcessAlive(pid), true);
  } finally {
    if (isProcessAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
});
