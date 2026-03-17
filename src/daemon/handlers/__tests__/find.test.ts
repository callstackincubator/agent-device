import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFindArgs, handleFindCommands } from '../find.ts';
import { AppError } from '../../../utils/errors.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import type { DaemonRequest } from '../../types.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-find-handler-'));
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

const INCREMENT_NODE = {
  type: 'Button',
  label: 'Increment',
  hittable: true,
  rect: { x: 50, y: 0, width: 100, height: 100 },
  depth: 0,
};

async function runFindClickScenario(options: {
  positionals: string[];
  nodes: Array<Record<string, unknown>>;
  invoke?: (req: DaemonRequest) => Promise<Record<string, unknown>>;
}): Promise<{
  response: NonNullable<Awaited<ReturnType<typeof handleFindCommands>>>;
  invokeCalls: DaemonRequest[];
}> {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  const invokeCalls: DaemonRequest[] = [];
  const response = await handleFindCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'find',
      positionals: options.positionals,
      flags: {},
    },
    sessionName,
    logPath: '/tmp/test.log',
    sessionStore,
    invoke: async (req) => {
      invokeCalls.push(req);
      const data = options.invoke ? await options.invoke(req) : {};
      return { ok: true, data };
    },
    dispatch: async (_device, command) => {
      if (command === 'snapshot') {
        return { nodes: options.nodes };
      }
      return {};
    },
  });

  assert.ok(response, 'expected a response');
  return { response, invokeCalls };
}

test('parseFindArgs defaults to click with any locator', () => {
  const parsed = parseFindArgs(['Login']);
  assert.equal(parsed.locator, 'any');
  assert.equal(parsed.query, 'Login');
  assert.equal(parsed.action, 'click');
});

test('parseFindArgs supports explicit locator and fill payload', () => {
  const parsed = parseFindArgs(['label', 'Email', 'fill', 'user@example.com']);
  assert.equal(parsed.locator, 'label');
  assert.equal(parsed.query, 'Email');
  assert.equal(parsed.action, 'fill');
  assert.equal(parsed.value, 'user@example.com');
});

test('parseFindArgs parses wait timeout', () => {
  const parsed = parseFindArgs(['text', 'Settings', 'wait', '2500']);
  assert.equal(parsed.locator, 'text');
  assert.equal(parsed.action, 'wait');
  assert.equal(parsed.timeoutMs, 2500);
});

test('parseFindArgs parses get text', () => {
  const parsed = parseFindArgs(['label', 'Price', 'get', 'text']);
  assert.equal(parsed.locator, 'label');
  assert.equal(parsed.query, 'Price');
  assert.equal(parsed.action, 'get_text');
});

test('parseFindArgs parses get attrs', () => {
  const parsed = parseFindArgs(['id', 'btn-1', 'get', 'attrs']);
  assert.equal(parsed.locator, 'id');
  assert.equal(parsed.query, 'btn-1');
  assert.equal(parsed.action, 'get_attrs');
});

test('parseFindArgs rejects invalid get sub-action', () => {
  assert.throws(
    () => parseFindArgs(['text', 'Settings', 'get', 'foo']),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('find get only supports text or attrs'),
  );
});

test('parseFindArgs parses type action with value', () => {
  const parsed = parseFindArgs(['label', 'Name', 'type', 'Jane']);
  assert.equal(parsed.locator, 'label');
  assert.equal(parsed.query, 'Name');
  assert.equal(parsed.action, 'type');
  assert.equal(parsed.value, 'Jane');
});

test('parseFindArgs joins multi-word fill value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'fill', 'hello', 'world']);
  assert.equal(parsed.action, 'fill');
  assert.equal(parsed.value, 'hello world');
});

test('parseFindArgs joins multi-word type value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'type', 'hello', 'world']);
  assert.equal(parsed.action, 'type');
  assert.equal(parsed.value, 'hello world');
});

test('parseFindArgs wait without timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait']);
  assert.equal(parsed.action, 'wait');
  assert.equal(parsed.timeoutMs, undefined);
});

test('parseFindArgs wait with non-numeric timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait', 'abc']);
  assert.equal(parsed.action, 'wait');
  assert.equal(parsed.timeoutMs, undefined);
});

test('parseFindArgs throws on unsupported action', () => {
  assert.throws(
    () => parseFindArgs(['text', 'OK', 'swipe']),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('Unsupported find action: swipe'),
  );
});

test('parseFindArgs with bare locator yields empty query', () => {
  const parsed = parseFindArgs(['text']);
  assert.equal(parsed.locator, 'text');
  assert.equal(parsed.query, '');
  assert.equal(parsed.action, 'click');
});

test('handleFindCommands click returns deterministic metadata across locator variants', async (t: TestContext) => {
  const hittableParentNoRect = { index: 0, type: 'View', hittable: true, depth: 0 };
  const nonHittableChildWithRect = {
    index: 1,
    type: 'StaticText',
    label: 'Increment',
    hittable: false,
    rect: { x: 50, y: 0, width: 100, height: 100 },
    depth: 1,
    parentIndex: 0,
  };

  const scenarios: Array<{
    label: string;
    positionals: string[];
    nodes: Array<Record<string, unknown>>;
    invoke?: (req: DaemonRequest) => Promise<Record<string, unknown>>;
    expectedKeys: string[];
    expectedLocator: string;
    expectedQuery: string;
    expectedCoordinates?: { x: number; y: number };
  }> = [
    {
      label: 'returns deterministic matched-target metadata',
      positionals: ['Increment', 'click'],
      nodes: [INCREMENT_NODE],
      invoke: async () => ({ platformSpecificRef: 'XCUIElementTypeApplication', x: 0, y: 0 }),
      expectedKeys: ['locator', 'query', 'ref', 'x', 'y'],
      expectedLocator: 'any',
      expectedQuery: 'Increment',
      expectedCoordinates: { x: 100, y: 50 },
    },
    {
      label: 'falls back to deterministic key set when resolved node has no rect',
      positionals: ['Increment', 'click'],
      nodes: [hittableParentNoRect, nonHittableChildWithRect],
      invoke: async () => ({ platformSpecificRef: 'XCUIElementTypeView' }),
      expectedKeys: ['locator', 'query', 'ref'],
      expectedLocator: 'any',
      expectedQuery: 'Increment',
    },
    {
      label: 'keeps explicit label locator in metadata',
      positionals: ['label', 'Increment', 'click'],
      nodes: [INCREMENT_NODE],
      expectedKeys: ['locator', 'query', 'ref', 'x', 'y'],
      expectedLocator: 'label',
      expectedQuery: 'Increment',
      expectedCoordinates: { x: 100, y: 50 },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.label, async () => {
      const { response, invokeCalls } = await runFindClickScenario(scenario);
      assert.ok(response.ok, 'expected success');

      const data = response.data as Record<string, unknown>;
      assert.deepEqual(Object.keys(data).sort(), scenario.expectedKeys);
      assert.equal(data.ref, '@e1', 'ref must match the resolved snapshot node');
      assert.equal(data.locator, scenario.expectedLocator);
      assert.equal(data.query, scenario.expectedQuery);

      if (scenario.expectedCoordinates) {
        assert.equal(data.x, scenario.expectedCoordinates.x);
        assert.equal(data.y, scenario.expectedCoordinates.y);
      } else {
        assert.equal(Object.hasOwn(data, 'x'), false);
        assert.equal(Object.hasOwn(data, 'y'), false);
      }

      assert.equal(invokeCalls.length, 1);
      assert.equal(invokeCalls[0].positionals?.[0], '@e1');
    });
  }
});
