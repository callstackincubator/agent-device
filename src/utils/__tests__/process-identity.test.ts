import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentDeviceDaemonCommand,
  isProcessAlive,
  readProcessStartTime,
  readProcessCommand,
} from '../process-identity.ts';

test('isProcessAlive returns false for invalid pid', () => {
  assert.equal(isProcessAlive(-1), false);
});

test('readProcessStartTime returns value for current process', () => {
  const startTime = readProcessStartTime(process.pid);
  if (startTime === null) {
    assert.equal(readProcessCommand(process.pid), null);
    return;
  }
  assert.ok(startTime.length > 0);
});

test('isAgentDeviceDaemonCommand matches expected daemon command', () => {
  assert.equal(
    isAgentDeviceDaemonCommand('node /usr/local/lib/node_modules/agent-device/dist/src/daemon.js'),
    true,
  );
  assert.equal(
    isAgentDeviceDaemonCommand('node --experimental-strip-types /tmp/agent-device/src/daemon.ts'),
    true,
  );
  assert.equal(isAgentDeviceDaemonCommand('node -e "setInterval(() => {}, 1000)"'), false);
});
