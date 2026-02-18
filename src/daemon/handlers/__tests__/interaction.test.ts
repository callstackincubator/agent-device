import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unsupportedRefSnapshotFlags } from '../interaction.ts';
import { handleInteractionCommands } from '../interaction.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { attachRefs } from '../../../utils/snapshot.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-interaction-handler-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
}

const contextFromFlags = (flags: CommandFlags | undefined) => ({
  count: flags?.count,
  intervalMs: flags?.intervalMs,
  holdMs: flags?.holdMs,
  jitterPx: flags?.jitterPx,
  doubleTap: flags?.doubleTap,
});

test('unsupportedRefSnapshotFlags returns unsupported snapshot flags for @ref flows', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    snapshotDepth: 2,
    snapshotScope: 'Login',
    snapshotRaw: true,
  });
  assert.deepEqual(unsupported, ['--depth', '--scope', '--raw']);
});

test('unsupportedRefSnapshotFlags returns empty when no ref-unsupported flags are present', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    platform: 'ios',
    session: 'default',
    verbose: true,
  });
  assert.deepEqual(unsupported, []);
});

test('click coordinates dispatches press and records as click', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  const dispatchCalls: Array<{ command: string; positionals: string[]; context: Record<string, unknown> | undefined }> =
    [];
  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'click',
      positionals: ['100', '200'],
      flags: { count: 3, intervalMs: 1, doubleTap: true },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
    dispatch: async (_device, command, positionals, _out, context) => {
      dispatchCalls.push({ command, positionals, context: context as Record<string, unknown> | undefined });
      return { ok: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'press');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['100', '200']);
  assert.equal(dispatchCalls[0]?.context?.count, 3);
  assert.equal(dispatchCalls[0]?.context?.intervalMs, 1);
  assert.equal(dispatchCalls[0]?.context?.doubleTap, true);

  const session = sessionStore.get(sessionName);
  assert.ok(session);
  assert.equal(session?.actions.length, 1);
  assert.equal(session?.actions[0]?.command, 'click');
  assert.deepEqual(session?.actions[0]?.positionals, ['100', '200']);
});

test('press @ref resolves snapshot node and records press action', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeButton',
        label: 'Continue',
        identifier: 'auth_continue',
        rect: { x: 10, y: 20, width: 100, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['@e1'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
    dispatch: async (_device, command, positionals) => {
      dispatchCalls.push({ command, positionals });
      return { pressed: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.ref, 'e1');
    assert.equal(response.data?.x, 60);
    assert.equal(response.data?.y, 40);
  }
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'press');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['60', '40']);

  const stored = sessionStore.get(sessionName);
  assert.ok(stored);
  assert.equal(stored?.actions.length, 1);
  assert.equal(stored?.actions[0]?.command, 'press');
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  assert.equal(result.ref, 'e1');
  assert.ok(Array.isArray(result.selectorChain));
});

test('press coordinates returns null to allow daemon passthrough', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  let dispatchCalls = 0;
  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['100', '200'],
      flags: { count: 2 },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
    dispatch: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  assert.equal(response, null);
  assert.equal(dispatchCalls, 0);
  assert.equal(sessionStore.get(sessionName)?.actions.length, 0);
});
