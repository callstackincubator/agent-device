import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handleSessionInventoryCommands } from '../session-inventory.ts';
import { SessionStore } from '../../session-store.ts';

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-inventory-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

test('session inventory lists iOS session metadata directly', async () => {
  const sessionStore = makeStore();
  sessionStore.set('ios-sim', {
    name: 'ios-sim',
    createdAt: 123,
    actions: [],
    surface: 'app',
    device: {
      platform: 'ios',
      id: 'sim-udid',
      name: 'iPhone 17',
      kind: 'simulator',
      simulatorSetPath: '/tmp/device-set',
    },
  });

  const response = await handleSessionInventoryCommands({
    req: {
      token: 't',
      session: 'ios-sim',
      command: 'session_list',
      positionals: [],
      flags: {},
    },
    sessionName: 'ios-sim',
    sessionStore,
    ensureReady: async () => {},
    resolveDevice: async () => {
      throw new Error('resolveDevice should not run for session_list');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response?.ok) {
    const sessions = response.data?.sessions as Array<Record<string, unknown>> | undefined;
    const session = sessions?.[0];
    assert.equal(session?.name, 'ios-sim');
    assert.equal(session?.device_udid, 'sim-udid');
    assert.equal(session?.ios_simulator_device_set, '/tmp/device-set');
  }
});
