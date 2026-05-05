import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSnapshotCommands } from '../snapshot.ts';
import {
  buildSnapshotState,
  buildSnapshotVisibility,
  captureSnapshot,
} from '../snapshot-capture.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import { AppError } from '../../../utils/errors.ts';
import { withMockedMacOsHelper } from '../../../platforms/ios/__tests__/macos-helper-test-utils.ts';
import { buildSnapshotSignatures } from '../../android-snapshot-freshness.ts';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return {
    ...actual,
    dispatchCommand: vi.fn(async () => ({})),
  };
});

vi.mock('../../../platforms/ios/runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/ios/runner-client.ts')>();
  return {
    ...actual,
    runIosRunnerCommand: vi.fn(async () => ({})),
    stopIosRunnerSession: vi.fn(async () => {}),
  };
});

import { dispatchCommand } from '../../../core/dispatch.ts';
import { runIosRunnerCommand } from '../../../platforms/ios/runner-client.ts';

const mockDispatch = vi.mocked(dispatchCommand);
const mockRunnerCommand = vi.mocked(runIosRunnerCommand);

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-snapshot-handler-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

const iosSimulatorDevice: SessionState['device'] = {
  platform: 'ios',
  id: 'sim-1',
  name: 'My iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

const macOsDevice: SessionState['device'] = {
  platform: 'macos',
  id: 'host-macos-local',
  name: 'Host Mac',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

const androidDevice: SessionState['device'] = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel 9 Pro XL',
  kind: 'emulator',
  target: 'mobile',
  booted: true,
};

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
  mockRunnerCommand.mockReset();
  mockRunnerCommand.mockResolvedValue({});
});

test('snapshot rejects @ref scope without existing session snapshot', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'My iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: { snapshotScope: '@e1' },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/requires an existing snapshot/i);
  }
});

test('snapshot surfaces filtered-to-zero Android guidance for interactive snapshots', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-empty-interactive';
  sessionStore.set(sessionName, makeSession(sessionName, androidDevice));

  mockDispatch.mockResolvedValue({
    nodes: [],
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 42, maxDepth: 8 },
  });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: { snapshotInteractiveOnly: true, snapshotDepth: 3 },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.warnings).toEqual([
      expect.stringContaining('Interactive snapshot is empty after filtering 42 raw Android nodes'),
      'Interactive output is empty at depth 3; retry without -d.',
    ]);
  }
});

test('snapshot warns when recent snapshot node count collapses sharply', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-stale-collapse';
  const session = makeSession(sessionName, androidDevice);
  session.snapshot = {
    nodes: Array.from({ length: 50 }, (_, index) => ({
      ref: `e${index + 1}`,
      index,
      depth: 0,
      type: 'android.widget.TextView',
      label: `Row ${index + 1}`,
    })),
    createdAt: Date.now(),
    backend: 'android',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({
    nodes: Array.from({ length: 8 }, (_, index) => ({
      index,
      depth: 0,
      type: 'android.widget.TextView',
      label: `Next ${index + 1}`,
    })),
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 8, maxDepth: 1 },
  });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.warnings).toEqual([
      expect.stringContaining('Recent snapshots dropped sharply in node count'),
    ]);
  }
});

test('snapshot automatically retries stale Android trees after recent navigation', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-stale-retries-to-fresh';
  const session = makeSession(sessionName, androidDevice);
  const baselineNodes = Array.from({ length: 24 }, (_, index) => ({
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
    comparisonSafe: true,
  };
  session.androidSnapshotFreshness = {
    action: 'press',
    markedAt: Date.now(),
    baselineCount: baselineNodes.length,
    baselineSignatures: buildSnapshotSignatures(baselineNodes),
    routeComparable: true,
  };
  sessionStore.set(sessionName, session);

  mockDispatch
    .mockResolvedValueOnce({
      nodes: Array.from({ length: 24 }, (_, index) => ({
        index,
        depth: 0,
        type: 'android.widget.TextView',
        label: `Inbox row ${index + 1}`,
      })),
      truncated: false,
      backend: 'android',
      analysis: { rawNodeCount: 24, maxDepth: 2 },
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

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: { snapshotInteractiveOnly: true },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.warnings).toBeUndefined();
    expect(response.data?.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Create expense' })]),
    );
  }
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(sessionStore.get(sessionName)?.androidSnapshotFreshness).toBeUndefined();
});

test('snapshot warns when Android freshness retries still return the previous route', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-stale-after-press';
  const session = makeSession(sessionName, androidDevice);
  const baselineNodes = Array.from({ length: 24 }, (_, index) => ({
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
    comparisonSafe: true,
  };
  session.androidSnapshotFreshness = {
    action: 'press',
    markedAt: Date.now(),
    baselineCount: baselineNodes.length,
    baselineSignatures: buildSnapshotSignatures(baselineNodes),
    routeComparable: true,
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({
    nodes: Array.from({ length: 24 }, (_, index) => ({
      index,
      depth: 0,
      type: 'android.widget.TextView',
      label: `Inbox row ${index + 1}`,
    })),
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 24, maxDepth: 2 },
  });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: { snapshotInteractiveOnly: true },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.warnings).toEqual([
      expect.stringContaining(
        'Recent press was followed by a nearly identical snapshot after 3 automatic retries',
      ),
    ]);
  }
  expect(mockDispatch).toHaveBeenCalledTimes(4);
});

test('snapshot response includes normalized visibility metadata', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-visibility';
  sessionStore.set(sessionName, makeSession(sessionName, androidDevice));

  mockDispatch.mockResolvedValue({
    nodes: [
      {
        index: 0,
        depth: 0,
        type: 'android.widget.ScrollView',
        label: 'Messages',
        rect: { x: 0, y: 100, width: 390, height: 500 },
        hiddenContentBelow: true,
      },
      {
        index: 1,
        depth: 1,
        parentIndex: 0,
        type: 'android.widget.Button',
        label: 'Visible message',
        rect: { x: 0, y: 140, width: 390, height: 48 },
        hittable: true,
      },
    ],
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 2, maxDepth: 1 },
  });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: { snapshotInteractiveOnly: true },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.visibility).toEqual({
      partial: true,
      visibleNodeCount: 2,
      totalNodeCount: 2,
      reasons: ['scroll-hidden-below'],
    });
  }
});

test('diff snapshot carries stale-tree warnings for recent Android presses', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-diff-stale-after-press';
  const session = makeSession(sessionName, androidDevice);
  const baselineNodes = Array.from({ length: 24 }, (_, index) => ({
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
    comparisonSafe: true,
  };
  session.androidSnapshotFreshness = {
    action: 'press',
    markedAt: Date.now(),
    baselineCount: baselineNodes.length,
    baselineSignatures: buildSnapshotSignatures(baselineNodes),
    routeComparable: true,
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({
    nodes: Array.from({ length: 24 }, (_, index) => ({
      index,
      depth: 0,
      type: 'android.widget.TextView',
      label: `Inbox row ${index + 1}`,
    })),
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 24, maxDepth: 2 },
  });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'diff',
      positionals: ['snapshot'],
      flags: { snapshotInteractiveOnly: true },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.warnings).toEqual([
      expect.stringContaining(
        'Recent press was followed by a nearly identical snapshot after 3 automatic retries',
      ),
    ]);
  }
  expect(mockDispatch).toHaveBeenCalledTimes(4);
});

test('Android ref refresh mode does not retry narrow snapshots as sharp drops', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-ref-refresh-no-sharp-drop';
  const session = makeSession(sessionName, androidDevice);
  const baselineNodes = Array.from({ length: 50 }, (_, index) => ({
    ref: `e${index + 1}`,
    index,
    depth: 0,
    type: 'android.widget.TextView',
    label: `Previous row ${index + 1}`,
  }));
  session.snapshot = {
    nodes: baselineNodes,
    createdAt: Date.now(),
    backend: 'android',
    comparisonSafe: true,
  };
  session.androidSnapshotFreshness = {
    action: 'press',
    markedAt: Date.now(),
    baselineCount: baselineNodes.length,
    baselineSignatures: buildSnapshotSignatures(baselineNodes),
    routeComparable: true,
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({
    nodes: Array.from({ length: 8 }, (_, index) => ({
      index,
      depth: 0,
      type: 'android.widget.TextView',
    })),
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 8, maxDepth: 1 },
  });

  const result = await captureSnapshot({
    device: androidDevice,
    session,
    flags: { snapshotInteractiveOnly: true, snapshotCompact: true },
    logPath: '/tmp/daemon.log',
    androidFreshnessMode: 'ref-refresh',
  });

  expect(result.freshness).toBeUndefined();
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(session.androidSnapshotFreshness).toBeUndefined();
});

test('wait text on Android uses freshness-aware capture instead of one-shot snapshot polling', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-wait-freshness';
  const session = makeSession(sessionName, androidDevice);
  const baselineNodes = Array.from({ length: 18 }, (_, index) => ({
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
    comparisonSafe: true,
  };
  session.androidSnapshotFreshness = {
    action: 'press',
    markedAt: Date.now(),
    baselineCount: baselineNodes.length,
    baselineSignatures: buildSnapshotSignatures(baselineNodes),
    routeComparable: true,
  };
  sessionStore.set(sessionName, session);

  mockDispatch
    .mockResolvedValueOnce({
      nodes: Array.from({ length: 18 }, (_, index) => ({
        index,
        depth: 0,
        type: 'android.widget.TextView',
        label: `Inbox row ${index + 1}`,
      })),
      truncated: false,
      backend: 'android',
      analysis: { rawNodeCount: 18, maxDepth: 1 },
    })
    .mockResolvedValueOnce({
      nodes: [
        { index: 0, depth: 0, type: 'android.widget.TextView', label: 'Create expense' },
        { index: 1, depth: 0, type: 'android.widget.TextView', label: 'Done' },
      ],
      truncated: false,
      backend: 'android',
      analysis: { rawNodeCount: 2, maxDepth: 1 },
    });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'wait',
      positionals: ['Create expense', '50'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.text).toBe('Create expense');
  }
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(sessionStore.get(sessionName)?.snapshot?.nodes).toEqual(
    expect.arrayContaining([expect.objectContaining({ label: 'Create expense' })]),
  );
});

test('settings rejects unsupported iOS physical devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'settings',
      positionals: ['wifi', 'on'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('UNSUPPORTED_OPERATION');
    expect(response.error.message).toMatch(/settings is not supported/i);
  }
});

test('settings usage hint documents canonical faceid states', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'settings',
      positionals: [],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/appearance <light\|dark\|toggle>/);
    expect(response.error.message).toMatch(/match\|nonmatch\|enroll\|unenroll/);
    expect(response.error.message).toMatch(/grant\|deny\|reset/);
    expect(response.error.message).not.toMatch(/validate\|unvalidate/);
  }
});

test('settings location set dispatches coordinates without placeholder slots', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-location';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, iosSimulatorDevice),
    appBundleId: 'com.example.maps',
  });
  mockDispatch.mockResolvedValue({ setting: 'location', state: 'set' });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'settings',
      positionals: ['location', 'set', '37.3349', '-122.009'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(mockDispatch).toHaveBeenCalledWith(
    iosSimulatorDevice,
    'settings',
    ['location', 'set', '37.3349', '-122.009', 'com.example.maps'],
    undefined,
    expect.objectContaining({ appBundleId: 'com.example.maps' }),
  );
});

test('settings on macOS returns helper-backed permission status', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      "cat <<'JSON'",
      '{"ok":true,"data":{"target":"accessibility","action":"grant","granted":true,"requested":false,"openedSettings":false,"message":"Accessibility access already granted."}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-settings';
      sessionStore.set(sessionName, makeSession(sessionName, macOsDevice));

      mockDispatch.mockResolvedValue({
        setting: 'permission',
        state: 'grant',
        target: 'accessibility',
        granted: true,
        requested: false,
        openedSettings: false,
        message: 'Accessibility access already granted.',
      });

      const response = await handleSnapshotCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'settings',
          positionals: ['permission', 'grant', 'accessibility'],
          flags: {},
        },
        sessionName,
        logPath: '/tmp/daemon.log',
        sessionStore,
      });

      expect(response?.ok).toBe(true);
      if (response && response.ok) {
        expect(response.data?.setting).toBe('permission');
        expect(response.data?.state).toBe('grant');
        expect(response.data?.target).toBe('accessibility');
        expect(response.data?.granted).toBe(true);
        expect(response.data?.requested).toBe(false);
        expect(response.data?.openedSettings).toBe(false);
      }
    },
  );
});

test('settings on macOS rejects wifi before dispatch with explicit subset guidance', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-settings-wifi';
  sessionStore.set(sessionName, makeSession(sessionName, macOsDevice));

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'settings',
      positionals: ['wifi', 'on'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  expect(mockDispatch).not.toHaveBeenCalled();
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/Unsupported macOS setting: wifi/i);
    expect(response.error.message).toMatch(/appearance <light\|dark\|toggle>/);
    expect(response.error.message).toMatch(
      /permission <grant\|reset> <accessibility\|screen-recording\|input-monitoring>/,
    );
    expect(response.error.message).toMatch(
      /wifi\|airplane\|location\|animations remain unsupported on macOS/i,
    );
  }
});

test('snapshot on macOS desktop surface uses helper-backed surface snapshot', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"desktop","nodes":[{"index":0,"depth":0,"type":"DesktopSurface","label":"Desktop","surface":"desktop"},{"index":1,"depth":1,"parentIndex":0,"type":"Window","label":"Notes","surface":"desktop","bundleId":"com.apple.Notes","appName":"Notes","windowTitle":"Notes","rect":{"x":32,"y":48,"width":640,"height":480}}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-desktop-snapshot';
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-desktop-snapshot-'));
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'desktop',
      });

      try {
        const response = await handleSnapshotCommands({
          req: {
            token: 't',
            session: sessionName,
            command: 'snapshot',
            positionals: [],
            flags: {},
          },
          sessionName,
          logPath: '/tmp/daemon.log',
          sessionStore,
        });

        expect(response?.ok).toBe(true);
        const logged = await fs.promises.readFile(argsLogPath, 'utf8');
        expect(logged).toBe('snapshot\n--surface\ndesktop\n');
        const updated = sessionStore.get(sessionName);
        expect(updated?.snapshot?.backend).toBe('macos-helper');
        expect(updated?.snapshot?.nodes[0]?.label).toBe('Desktop');
        expect(updated?.snapshot?.nodes[1]?.windowTitle).toBe('Notes');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

test('snapshot on macOS desktop surface applies scope and depth after helper capture', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"desktop","nodes":[{"index":0,"depth":0,"type":"DesktopSurface","label":"Desktop","surface":"desktop"},{"index":1,"depth":1,"parentIndex":0,"type":"Application","label":"Notes","surface":"desktop","bundleId":"com.apple.Notes","appName":"Notes"},{"index":2,"depth":2,"parentIndex":1,"type":"Window","label":"Notes","surface":"desktop","windowTitle":"Notes","rect":{"x":32,"y":48,"width":640,"height":480}},{"index":3,"depth":3,"parentIndex":2,"type":"StaticText","label":"Pinned","surface":"desktop","rect":{"x":40,"y":60,"width":80,"height":24}}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-desktop-scoped-snapshot';
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'desktop',
      });

      const response = await handleSnapshotCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'snapshot',
          positionals: [],
          flags: { snapshotScope: 'Notes', snapshotDepth: 0 },
        },
        sessionName,
        logPath: '/tmp/daemon.log',
        sessionStore,
      });

      expect(response?.ok).toBe(true);
      const updated = sessionStore.get(sessionName);
      expect(updated?.snapshot?.backend).toBe('macos-helper');
      expect(updated?.snapshot?.nodes.length).toBe(1);
      expect(updated?.snapshot?.nodes[0]?.label).toBe('Notes');
      expect(updated?.snapshot?.nodes[0]?.depth).toBe(0);
      expect(updated?.snapshot?.nodes[0]?.parentIndex).toBeUndefined();
    },
  );
});

test('snapshot on macOS menubar surface uses helper-backed surface snapshot', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"menubar","nodes":[{"index":0,"depth":0,"type":"MenuBarSurface","label":"Menu Bar","surface":"menubar"},{"index":1,"depth":1,"parentIndex":0,"type":"MenuBarItem","label":"File","surface":"menubar"}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-menubar-snapshot';
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-menubar-snapshot-'));
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'menubar',
      });

      try {
        const response = await handleSnapshotCommands({
          req: {
            token: 't',
            session: sessionName,
            command: 'snapshot',
            positionals: [],
            flags: {},
          },
          sessionName,
          logPath: '/tmp/daemon.log',
          sessionStore,
        });

        expect(response?.ok).toBe(true);
        const logged = await fs.promises.readFile(argsLogPath, 'utf8');
        expect(logged).toBe('snapshot\n--surface\nmenubar\n');
        expect(sessionStore.get(sessionName)?.snapshot?.nodes[1]?.label).toBe('File');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

test('snapshot on targeted macOS menubar surface passes bundle id to helper', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"menubar","nodes":[{"index":0,"depth":0,"type":"MenuBarSurface","label":"Menu Bar","surface":"menubar"},{"index":1,"depth":1,"parentIndex":0,"type":"MenuBarItem","label":"MenuBarApp","surface":"menubar","bundleId":"com.example.menubarapp","appName":"MenuBarApp"}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-menubar-targeted-snapshot';
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-menubar-targeted-'));
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'menubar',
        appBundleId: 'com.example.menubarapp',
        appName: 'MenuBarApp',
      });

      try {
        const response = await handleSnapshotCommands({
          req: {
            token: 't',
            session: sessionName,
            command: 'snapshot',
            positionals: [],
            flags: {},
          },
          sessionName,
          logPath: '/tmp/daemon.log',
          sessionStore,
        });

        expect(response?.ok).toBe(true);
        const logged = await fs.promises.readFile(argsLogPath, 'utf8');
        expect(logged).toBe('snapshot\n--surface\nmenubar\n--bundle-id\ncom.example.menubarapp\n');
        expect(sessionStore.get(sessionName)?.snapshot?.nodes[1]?.label).toBe('MenuBarApp');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

test('snapshot on macOS frontmost-app surface uses helper-backed surface snapshot', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"frontmost-app","nodes":[{"index":0,"depth":0,"type":"Application","label":"TextEdit","surface":"frontmost-app","bundleId":"com.apple.TextEdit","appName":"TextEdit"},{"index":1,"depth":1,"parentIndex":0,"type":"Window","label":"Untitled","surface":"frontmost-app","windowTitle":"Untitled","rect":{"x":32,"y":48,"width":640,"height":480}}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-frontmost-app-snapshot';
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-frontmost-snapshot-'));
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'frontmost-app',
        appBundleId: 'com.apple.systempreferences',
        appName: 'System Settings',
      });

      try {
        const response = await handleSnapshotCommands({
          req: {
            token: 't',
            session: sessionName,
            command: 'snapshot',
            positionals: [],
            flags: {},
          },
          sessionName,
          logPath: '/tmp/daemon.log',
          sessionStore,
        });

        expect(response?.ok).toBe(true);
        const logged = await fs.promises.readFile(argsLogPath, 'utf8');
        expect(logged).toBe('snapshot\n--surface\nfrontmost-app\n');
        const updated = sessionStore.get(sessionName);
        expect(updated?.snapshot?.backend).toBe('macos-helper');
        expect(updated?.snapshot?.nodes[0]?.label).toBe('TextEdit');
        expect(updated?.snapshot?.nodes[1]?.parentIndex).toBe(0);
        expect(updated?.snapshot?.nodes[1]?.windowTitle).toBe('Untitled');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

test('wait text on macOS desktop surface polls helper-backed snapshots instead of runner text search', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      "cat <<'JSON'",
      '{"ok":true,"data":{"surface":"desktop","nodes":[{"index":0,"depth":0,"type":"DesktopSurface","label":"Desktop","surface":"desktop"},{"index":1,"depth":1,"parentIndex":0,"type":"StaticText","label":"Accessibility","surface":"desktop"}],"truncated":false,"backend":"macos-helper"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-desktop-wait';
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'desktop',
      });

      const response = await handleSnapshotCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'wait',
          positionals: ['Accessibility', '10'],
          flags: {},
        },
        sessionName,
        logPath: '/tmp/daemon.log',
        sessionStore,
      });

      expect(response?.ok).toBe(true);
      expect(mockRunnerCommand).not.toHaveBeenCalled();
      const updated = sessionStore.get(sessionName);
      expect(updated?.snapshot?.backend).toBe('macos-helper');
    },
  );
});

test('diff rejects unsupported kind', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'diff',
      positionals: ['unknown'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/diff.*supports.*snapshot/i);
  }
});

test('diff screenshot is not handled daemon-side (client-backed command)', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'diff',
      positionals: ['screenshot'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/diff.*supports.*snapshot/i);
  }
});

test('diff initializes baseline on first run and updates it for subsequent runs', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'My iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );

  let snapshotCall = 0;
  mockDispatch.mockImplementation(async () => {
    snapshotCall += 1;
    if (snapshotCall === 1) {
      return {
        nodes: [
          { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
          { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: '67' },
        ],
        truncated: false,
        backend: 'xctest' as const,
      };
    }
    return {
      nodes: [
        { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
        { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: '134' },
      ],
      truncated: false,
      backend: 'xctest' as const,
    };
  });

  const first = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'diff',
      positionals: ['snapshot'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(first).toBeTruthy();
  expect(first?.ok).toBe(true);
  if (first && first.ok) {
    expect((first.data as any).baselineInitialized).toBe(true);
    expect((first.data as any).lines).toEqual([]);
  }
  const baselineSession = sessionStore.get(sessionName);
  expect(baselineSession?.snapshot).toBeTruthy();
  expect(baselineSession?.snapshot?.nodes[1]?.label).toBe('67');

  const second = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'diff',
      positionals: ['snapshot'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(second).toBeTruthy();
  expect(second?.ok).toBe(true);
  if (second && second.ok) {
    expect((second.data as any).baselineInitialized).toBe(false);
    expect((second.data as any).summary.additions).toBe(1);
    expect((second.data as any).summary.removals).toBe(1);
  }
  const updatedSession = sessionStore.get(sessionName);
  expect(updatedSession?.snapshot?.nodes[1]?.label).toBe('134');
});

test('wait text uses Apple runner path on macOS desktop sessions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-wait';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, macOsDevice),
    appBundleId: 'com.apple.systempreferences',
  });

  mockRunnerCommand.mockResolvedValue({ found: true });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'wait',
      positionals: ['Accessibility', '10'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(mockRunnerCommand).toHaveBeenCalledTimes(1);
  const callArgs = mockRunnerCommand.mock.calls[0];
  expect((callArgs?.[1] as any)?.command).toBe('findText');
  expect((callArgs?.[1] as any)?.text).toBe('Accessibility');
});

test('alert accept retries on "alert not found" and succeeds on second attempt', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  mockRunnerCommand.mockImplementation(async () => {
    calls += 1;
    if (calls === 1) throw new AppError('COMMAND_FAILED', 'alert not found');
    return { accepted: true };
  });

  const response = await handleSnapshotCommands({
    req: { token: 't', session: sessionName, command: 'alert', positionals: ['accept'], flags: {} },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(calls).toBe(2);
});

test('alert accept does not retry on non-alert errors', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  mockRunnerCommand.mockImplementation(async () => {
    calls += 1;
    throw new AppError('COMMAND_FAILED', 'runner crashed');
  });

  await expect(
    handleSnapshotCommands({
      req: {
        token: 't',
        session: sessionName,
        command: 'alert',
        positionals: ['accept'],
        flags: {},
      },
      sessionName,
      logPath: '/tmp/daemon.log',
      sessionStore,
    }),
  ).rejects.toThrow('runner crashed');

  expect(calls).toBe(1);
});

test('alert accept adds a scoped-snapshot hint after retrying alert-not-found failures', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  mockRunnerCommand.mockRejectedValue(new AppError('COMMAND_FAILED', 'alert not found'));

  let thrown: unknown;
  try {
    await handleSnapshotCommands({
      req: {
        token: 't',
        session: sessionName,
        command: 'alert',
        positionals: ['accept'],
        flags: {},
      },
      sessionName,
      logPath: '/tmp/daemon.log',
      sessionStore,
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).message).toBe('alert not found');
  expect((thrown as AppError).details?.hint).toMatch(/scoped snapshot/i);
});

test('alert dismiss retries on "no alert" message', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  mockRunnerCommand.mockImplementation(async () => {
    calls += 1;
    if (calls < 3) throw new AppError('COMMAND_FAILED', 'no alert present');
    return { dismissed: true };
  });

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'alert',
      positionals: ['dismiss'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(calls).toBe(3);
});

test('alert get does not retry on failure', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  mockRunnerCommand.mockImplementation(async () => {
    calls += 1;
    throw new AppError('COMMAND_FAILED', 'alert not found');
  });

  await expect(
    handleSnapshotCommands({
      req: { token: 't', session: sessionName, command: 'alert', positionals: ['get'], flags: {} },
      sessionName,
      logPath: '/tmp/daemon.log',
      sessionStore,
    }),
  ).rejects.toThrow();

  expect(calls).toBe(1);
});

test('alert get on macOS uses helper-backed alert path', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      "cat <<'JSON'",
      '{"ok":true,"data":{"title":"Allow Access","role":"AXSheet","buttons":["Allow","Don\\u2019t Allow"],"bundleId":"com.apple.systempreferences"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-alert';
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, {
          platform: 'macos',
          id: 'host-macos-local',
          name: 'Host Mac',
          kind: 'device',
          target: 'desktop',
          booted: true,
        }),
        appBundleId: 'com.apple.systempreferences',
        appName: 'System Settings',
      });

      const response = await handleSnapshotCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'alert',
          positionals: ['get'],
          flags: {},
        },
        sessionName,
        logPath: '/tmp/daemon.log',
        sessionStore,
      });

      expect(response?.ok).toBe(true);
      if (response && response.ok) {
        expect(response.data?.title).toBe('Allow Access');
        expect(response.data?.buttons).toEqual(['Allow', 'Don\u2019t Allow']);
      }
    },
  );
});

test('alert get on macOS frontmost-app surface targets the helper surface, not the stored bundle id', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"title":"Allow Access","role":"AXSheet","buttons":["Allow"],"bundleId":"com.apple.TextEdit"}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-alert-frontmost';
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-alert-frontmost-'));
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, macOsDevice),
        surface: 'frontmost-app',
        appBundleId: 'com.apple.systempreferences',
        appName: 'System Settings',
      });

      try {
        const response = await handleSnapshotCommands({
          req: {
            token: 't',
            session: sessionName,
            command: 'alert',
            positionals: ['get'],
            flags: {},
          },
          sessionName,
          logPath: '/tmp/daemon.log',
          sessionStore,
        });

        expect(response?.ok).toBe(true);
        const logged = await fs.promises.readFile(argsLogPath, 'utf8');
        expect(logged).toBe('alert\nget\n--surface\nfrontmost-app\n');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

test('wait sleep bypasses sessionless runner cleanup wrapper', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'wait',
      positionals: ['0'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Malformed snapshot data – buildSnapshotState robustness
// ---------------------------------------------------------------------------

test('buildSnapshotState handles undefined nodes gracefully', () => {
  const state = buildSnapshotState({ nodes: undefined, truncated: undefined }, undefined);
  expect(state.nodes).toEqual([]);
  expect(state.truncated).toBeUndefined();
  expect(state.createdAt).toBeGreaterThan(0);
});

test('buildSnapshotState handles completely empty data object', () => {
  const state = buildSnapshotState({}, undefined);
  expect(state.nodes).toEqual([]);
  expect(state.truncated).toBeUndefined();
});

test('buildSnapshotState handles nodes with missing fields', () => {
  const state = buildSnapshotState(
    {
      nodes: [
        { index: 0 } as any,
        { index: 1, depth: undefined, type: undefined, label: undefined } as any,
      ],
      truncated: false,
      backend: 'android',
    },
    undefined,
  );
  expect(state.nodes).toHaveLength(2);
  // Nodes should get refs assigned even with sparse data
  expect(state.nodes[0]?.ref).toBeTruthy();
  expect(state.nodes[1]?.ref).toBeTruthy();
});

test('buildSnapshotState marks comparisonSafe false for filtered Android snapshots', () => {
  const nodes = [{ index: 0, depth: 0, type: 'android.widget.TextView', label: 'A' }];

  const interactiveOnly = buildSnapshotState(
    { nodes, backend: 'android' },
    { snapshotInteractiveOnly: true },
  );
  expect(interactiveOnly.comparisonSafe).toBe(false);

  const compact = buildSnapshotState({ nodes, backend: 'android' }, { snapshotCompact: true });
  expect(compact.comparisonSafe).toBe(false);

  const withDepth = buildSnapshotState({ nodes, backend: 'android' }, { snapshotDepth: 2 });
  expect(withDepth.comparisonSafe).toBe(false);

  const withScope = buildSnapshotState({ nodes, backend: 'android' }, { snapshotScope: 'Header' });
  expect(withScope.comparisonSafe).toBe(false);

  const unfiltered = buildSnapshotState({ nodes, backend: 'android' }, {});
  expect(unfiltered.comparisonSafe).toBe(true);
});

test('buildSnapshotState marks comparisonSafe false for non-Android backends', () => {
  const nodes = [{ index: 0, depth: 0, type: 'Button', label: 'OK' }];
  const state = buildSnapshotState({ nodes, backend: 'xctest' }, {});
  expect(state.comparisonSafe).toBe(false);
});

test('buildSnapshotState returns empty nodes when scoped snapshot has no label match', () => {
  const nodes = [
    { index: 0, depth: 0, type: 'Window', label: 'Root' },
    { index: 1, depth: 1, type: 'Button', label: 'Search' },
  ];

  const state = buildSnapshotState(
    { nodes, backend: 'xctest' },
    { snapshotScope: 'zzzz-no-match-token' },
  );

  expect(state.nodes).toEqual([]);
});

// ---------------------------------------------------------------------------
// Malformed snapshot data – buildSnapshotVisibility robustness
// ---------------------------------------------------------------------------

test('buildSnapshotVisibility returns non-partial for empty node list', () => {
  const vis = buildSnapshotVisibility({ nodes: [], backend: 'android' });
  expect(vis.partial).toBe(false);
  expect(vis.visibleNodeCount).toBe(0);
  expect(vis.totalNodeCount).toBe(0);
  expect(vis.reasons).toEqual([]);
});

test('buildSnapshotVisibility skips semantic analysis for raw snapshots', () => {
  const nodes = [
    { ref: 'e1', index: 0, depth: 0, type: 'View', label: 'Root', hiddenContentBelow: true },
  ];
  const vis = buildSnapshotVisibility({ nodes, backend: 'android', snapshotRaw: true });
  expect(vis.partial).toBe(false);
  expect(vis.visibleNodeCount).toBe(1);
  expect(vis.totalNodeCount).toBe(1);
  expect(vis.reasons).toEqual([]);
});

test('buildSnapshotVisibility skips semantic analysis for macos-helper backend', () => {
  const nodes = [{ ref: 'e1', index: 0, depth: 0, type: 'AXButton', label: 'Click Me' }];
  const vis = buildSnapshotVisibility({ nodes, backend: 'macos-helper' });
  expect(vis.partial).toBe(false);
  expect(vis.reasons).toEqual([]);
});

test('buildSnapshotVisibility detects scroll-hidden-above and scroll-hidden-below', () => {
  const nodes = [
    {
      ref: 'e1',
      index: 0,
      depth: 0,
      type: 'ScrollView',
      label: 'Feed',
      hiddenContentAbove: true,
      hiddenContentBelow: true,
    },
  ];
  const vis = buildSnapshotVisibility({ nodes, backend: 'android' });
  expect(vis.partial).toBe(true);
  expect(vis.reasons).toContain('scroll-hidden-above');
  expect(vis.reasons).toContain('scroll-hidden-below');
});

test('buildSnapshotVisibility handles nodes with no scroll hints as non-partial', () => {
  const nodes = [
    { ref: 'e1', index: 0, depth: 0, type: 'Button', label: 'OK', hittable: true },
    { ref: 'e2', index: 1, depth: 0, type: 'Button', label: 'Cancel', hittable: true },
  ];
  const vis = buildSnapshotVisibility({ nodes, backend: 'xctest' });
  expect(vis.partial).toBe(false);
  expect(vis.visibleNodeCount).toBe(2);
  expect(vis.totalNodeCount).toBe(2);
  expect(vis.reasons).toEqual([]);
});
