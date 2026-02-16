import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIosReadyPayload, resolveIosReadyHint } from '../device-ready.ts';

test('parseIosReadyPayload reads tunnelState from direct connectionProperties', () => {
  const parsed = parseIosReadyPayload({
    result: {
      connectionProperties: {
        tunnelState: 'connected',
      },
    },
  });
  assert.equal(parsed.tunnelState, 'connected');
});

test('parseIosReadyPayload reads tunnelState from nested device connectionProperties', () => {
  const parsed = parseIosReadyPayload({
    result: {
      device: {
        connectionProperties: {
          tunnelState: 'connecting',
        },
      },
    },
  });
  assert.equal(parsed.tunnelState, 'connecting');
});

test('parseIosReadyPayload returns empty payload for malformed input', () => {
  assert.deepEqual(parseIosReadyPayload(null), {});
  assert.deepEqual(parseIosReadyPayload({}), {});
  assert.deepEqual(
    parseIosReadyPayload({
      result: { connectionProperties: { tunnelState: 123 } },
    }),
    {},
  );
});

test('resolveIosReadyHint maps known connection errors', () => {
  const connecting = resolveIosReadyHint('', 'Device is busy (Connecting to iPhone)');
  assert.match(connecting, /still connecting/i);

  const coreDeviceTimeout = resolveIosReadyHint('CoreDeviceService timed out', '');
  assert.match(coreDeviceTimeout, /coredevice service/i);
});

test('resolveIosReadyHint falls back to generic guidance', () => {
  const hint = resolveIosReadyHint('unexpected failure', '');
  assert.match(hint, /unlocked/i);
  assert.match(hint, /xcode/i);
});
