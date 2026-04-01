import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFindArgs, handleFindCommands } from '../find.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import { withMockedMacOsHelper } from '../../../platforms/ios/__tests__/macos-helper-test-utils.ts';
import { buildSnapshotSignatures } from '../../android-snapshot-freshness.ts';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return {
    ...actual,
    dispatchCommand: vi.fn(async (_device: unknown, command: string) => {
      return command === 'snapshot' ? { nodes: [] } : {};
    }),
    resolveTargetDevice: actual.resolveTargetDevice,
  };
});

import { dispatchCommand } from '../../../core/dispatch.ts';

const mockDispatch = vi.mocked(dispatchCommand);

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockImplementation(async (_device: unknown, command: string) => {
    return command === 'snapshot' ? { nodes: [] } : {};
  });
});

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

function makeMacOsSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'macos',
      id: 'macos-host',
      name: 'Mac',
      kind: 'device',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
    surface: 'desktop',
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
  nodes?: Array<Record<string, unknown>>;
  flags?: DaemonRequest['flags'];
  session?: SessionState;
  invoke?: (req: DaemonRequest) => Promise<Record<string, unknown>>;
}): Promise<{
  response: NonNullable<Awaited<ReturnType<typeof handleFindCommands>>>;
  invokeCalls: DaemonRequest[];
}> {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, options.session ?? makeSession(sessionName));

  if (options.nodes !== undefined) {
    mockDispatch.mockImplementation(async (_device, command) => {
      if (command === 'snapshot') {
        return { nodes: options.nodes };
      }
      return {};
    });
  }

  const invokeCalls: DaemonRequest[] = [];
  const response = await handleFindCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'find',
      positionals: options.positionals,
      flags: options.flags ?? {},
    },
    sessionName,
    logPath: '/tmp/test.log',
    sessionStore,
    invoke: async (req) => {
      invokeCalls.push(req);
      const data = options.invoke ? await options.invoke(req) : {};
      return { ok: true, data } as DaemonResponse;
    },
  });

  expect(response).toBeTruthy();
  return { response: response!, invokeCalls };
}

test('parseFindArgs defaults to click with any locator', () => {
  const parsed = parseFindArgs(['Login']);
  expect(parsed.locator).toBe('any');
  expect(parsed.query).toBe('Login');
  expect(parsed.action).toBe('click');
});

test('parseFindArgs supports explicit locator and fill payload', () => {
  const parsed = parseFindArgs(['label', 'Email', 'fill', 'user@example.com']);
  expect(parsed.locator).toBe('label');
  expect(parsed.query).toBe('Email');
  expect(parsed.action).toBe('fill');
  expect(parsed.value).toBe('user@example.com');
});

test('parseFindArgs parses wait timeout', () => {
  const parsed = parseFindArgs(['text', 'Settings', 'wait', '2500']);
  expect(parsed.locator).toBe('text');
  expect(parsed.action).toBe('wait');
  expect(parsed.timeoutMs).toBe(2500);
});

test('parseFindArgs parses get text', () => {
  const parsed = parseFindArgs(['label', 'Price', 'get', 'text']);
  expect(parsed.locator).toBe('label');
  expect(parsed.query).toBe('Price');
  expect(parsed.action).toBe('get_text');
});

test('parseFindArgs parses get attrs', () => {
  const parsed = parseFindArgs(['id', 'btn-1', 'get', 'attrs']);
  expect(parsed.locator).toBe('id');
  expect(parsed.query).toBe('btn-1');
  expect(parsed.action).toBe('get_attrs');
});

test('parseFindArgs rejects invalid get sub-action', () => {
  expect(() => parseFindArgs(['text', 'Settings', 'get', 'foo'])).toThrow(
    expect.objectContaining({
      code: 'INVALID_ARGS',
      message: expect.stringContaining('find get only supports text or attrs'),
    }),
  );
});

test('parseFindArgs parses type action with value', () => {
  const parsed = parseFindArgs(['label', 'Name', 'type', 'Jane']);
  expect(parsed.locator).toBe('label');
  expect(parsed.query).toBe('Name');
  expect(parsed.action).toBe('type');
  expect(parsed.value).toBe('Jane');
});

test('parseFindArgs joins multi-word fill value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'fill', 'hello', 'world']);
  expect(parsed.action).toBe('fill');
  expect(parsed.value).toBe('hello world');
});

test('parseFindArgs joins multi-word type value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'type', 'hello', 'world']);
  expect(parsed.action).toBe('type');
  expect(parsed.value).toBe('hello world');
});

test('parseFindArgs wait without timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait']);
  expect(parsed.action).toBe('wait');
  expect(parsed.timeoutMs).toBeUndefined();
});

test('parseFindArgs wait with non-numeric timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait', 'abc']);
  expect(parsed.action).toBe('wait');
  expect(parsed.timeoutMs).toBeUndefined();
});

test('parseFindArgs throws on unsupported action', () => {
  expect(() => parseFindArgs(['text', 'OK', 'swipe'])).toThrow(
    expect.objectContaining({
      code: 'INVALID_ARGS',
      message: expect.stringContaining('Unsupported find action: swipe'),
    }),
  );
});

test('parseFindArgs with bare locator yields empty query', () => {
  const parsed = parseFindArgs(['text']);
  expect(parsed.locator).toBe('text');
  expect(parsed.query).toBe('');
  expect(parsed.action).toBe('click');
});

test('handleFindCommands rejects --first with --last', async () => {
  const { response } = await runFindClickScenario({
    positionals: ['Increment', 'click'],
    nodes: [INCREMENT_NODE],
    flags: { findFirst: true, findLast: true },
  });

  expect(response.ok).toBe(false);
  if (!response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toContain('only one of --first or --last');
  }
});

test('handleFindCommands click returns deterministic metadata across locator variants', async () => {
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

  const scenarios = [
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
    const { response, invokeCalls } = await runFindClickScenario(scenario);
    expect(response.ok, scenario.label).toBe(true);
    if (!response.ok) return;
    const data = response.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(scenario.expectedKeys);
    expect(data.ref).toBe('@e1');
    expect(data.locator).toBe(scenario.expectedLocator);
    expect(data.query).toBe(scenario.expectedQuery);

    if (scenario.expectedCoordinates) {
      expect(data.x).toBe(scenario.expectedCoordinates.x);
      expect(data.y).toBe(scenario.expectedCoordinates.y);
    } else {
      expect(Object.hasOwn(data, 'x')).toBe(false);
      expect(Object.hasOwn(data, 'y')).toBe(false);
    }

    expect(invokeCalls.length).toBe(1);
    expect(invokeCalls[0].positionals?.[0]).toBe('@e1');
  }
});

test('handleFindCommands wait bypasses snapshot cache while Android freshness recovery is active', async () => {
  const sessionName = 'android-find-wait';
  const session: SessionState = {
    name: sessionName,
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel 9 Pro XL',
      kind: 'emulator',
      target: 'mobile',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
  const baselineNodes = Array.from({ length: 16 }, (_, index) => ({
    ref: `e${index + 1}`,
    index,
    depth: 0,
    type: 'android.widget.TextView',
    label: `Inbox row ${index + 1}`,
  }));
  session.snapshot = {
    nodes: baselineNodes,
    createdAt: Date.now(),
    backend: 'android',
  };
  session.androidSnapshotFreshness = {
    action: 'press',
    markedAt: Date.now(),
    baselineCount: baselineNodes.length,
    baselineSignatures: buildSnapshotSignatures(baselineNodes),
  };

  mockDispatch
    .mockResolvedValueOnce({
      nodes: Array.from({ length: 16 }, (_, index) => ({
        index,
        depth: 0,
        type: 'android.widget.TextView',
        label: `Inbox row ${index + 1}`,
      })),
      truncated: false,
      backend: 'android',
      analysis: { rawNodeCount: 16, maxDepth: 1 },
    })
    .mockResolvedValueOnce({
      nodes: [
        { index: 0, depth: 0, type: 'android.widget.TextView', label: 'Create expense' },
        { index: 1, depth: 0, type: 'android.widget.Button', label: 'Submit', hittable: true },
      ],
      truncated: false,
      backend: 'android',
      analysis: { rawNodeCount: 2, maxDepth: 1 },
    });

  const { response } = await runFindClickScenario({
    positionals: ['text', 'Create expense', 'wait', '700'],
    session,
  });

  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.found).toBe(true);
  }
  expect(mockDispatch).toHaveBeenCalledTimes(2);
});

test('handleFindCommands uses helper-backed snapshots for macOS desktop sessions', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"desktop","nodes":[{"index":0,"depth":0,"type":"DesktopSurface","label":"Desktop","surface":"desktop"},{"index":1,"depth":1,"parentIndex":0,"type":"Window","label":"Notes","surface":"desktop","rect":{"x":32,"y":48,"width":640,"height":480}}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async ({ tmpDir }) => {
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-desktop-find';
      sessionStore.set(sessionName, makeMacOsSession(sessionName));
      let snapshotDispatchCalls = 0;

      mockDispatch.mockImplementation(async (_device, command) => {
        if (command === 'snapshot') {
          snapshotDispatchCalls += 1;
        }
        return {};
      });

      try {
        const response = await handleFindCommands({
          req: {
            token: 't',
            session: sessionName,
            command: 'find',
            positionals: ['label', 'Notes', 'get', 'attrs'],
            flags: {},
          },
          sessionName,
          logPath: '/tmp/test.log',
          sessionStore,
          invoke: async () => ({ ok: true }) as DaemonResponse,
        });

        expect(response?.ok).toBe(true);
        expect(snapshotDispatchCalls).toBe(0);
        const logged = await fs.promises.readFile(argsLogPath, 'utf8');
        expect(logged).toBe('snapshot\n--surface\ndesktop\n');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
      }
    },
  );
});
