import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSnapshotCommands } from '../snapshot.ts';
import { captureSnapshot } from '../snapshot-capture.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import { AppError } from '../../../utils/errors.ts';
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

async function runWaitCommand(
  sessionName: string,
  device: SessionState['device'],
  positionals: string[],
) {
  const sessionStore = makeSessionStore();
  sessionStore.set(sessionName, makeSession(sessionName, device));
  return await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'wait',
      positionals,
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });
}

const locationPermissionNodes = [
  {
    index: 0,
    depth: 0,
    type: 'android.widget.FrameLayout',
    label: 'Location permission',
    rect: { x: 0, y: 0, width: 390, height: 844 },
  },
  {
    index: 1,
    depth: 1,
    parentIndex: 0,
    type: 'android.widget.TextView',
    label: 'Allow location access?',
    rect: { x: 24, y: 210, width: 342, height: 40 },
  },
  {
    index: 2,
    depth: 1,
    parentIndex: 0,
    type: 'android.widget.Button',
    label: 'Not now',
    rect: { x: 24, y: 320, width: 140, height: 48 },
    hittable: true,
  },
  {
    index: 3,
    depth: 1,
    parentIndex: 0,
    type: 'android.widget.Button',
    label: 'Continue',
    rect: { x: 180, y: 320, width: 160, height: 48 },
    hittable: true,
  },
];

const locationRequiredNodes = [
  {
    index: 0,
    depth: 0,
    type: 'android.widget.TextView',
    label: 'Location required',
    rect: { x: 24, y: 180, width: 342, height: 40 },
  },
  {
    index: 1,
    depth: 0,
    type: 'android.widget.Button',
    label: 'Dismiss',
    rect: { x: 24, y: 260, width: 342, height: 48 },
  },
];

const iosSurfaceSummaryNodes = [
  {
    index: 0,
    depth: 0,
    type: 'XCUIElementTypeApplication',
    label: 'Expo Go',
    rect: { x: 0, y: 0, width: 393, height: 852 },
  },
  {
    index: 1,
    depth: 1,
    type: 'XCUIElementTypeImage',
    label: 'gearshape.fill',
    rect: { x: 12, y: 54, width: 24, height: 24 },
  },
  {
    index: 2,
    depth: 1,
    type: 'XCUIElementTypeOther',
    label: 'Tab Bar',
    rect: { x: 0, y: 760, width: 393, height: 92 },
  },
  {
    index: 3,
    depth: 1,
    type: 'XCUIElementTypeStaticText',
    label: 'Confirm catalog refresh',
    rect: { x: 48, y: 280, width: 297, height: 36 },
  },
  {
    index: 4,
    depth: 1,
    type: 'XCUIElementTypeButton',
    label: 'Keep browsing',
    rect: { x: 48, y: 360, width: 297, height: 48 },
  },
  {
    index: 5,
    depth: 1,
    type: 'XCUIElementTypeButton',
    identifier: 'host.exp.exponent:id/reload_button',
    rect: { x: 260, y: 54, width: 48, height: 48 },
  },
];

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
        { index: 0, depth: 0, type: 'android.widget.TextView', label: 'Create document' },
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
      expect.arrayContaining([expect.objectContaining({ label: 'Create document' })]),
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
        { index: 0, depth: 0, type: 'android.widget.TextView', label: 'Create document' },
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
      positionals: ['Create document', '50'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.text).toBe('Create document');
  }
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(sessionStore.get(sessionName)?.snapshot?.nodes).toEqual(
    expect.arrayContaining([expect.objectContaining({ label: 'Create document' })]),
  );
});

test('wait text timeout includes compact current-surface labels and buttons', async () => {
  const sessionName = 'android-wait-timeout-surface';
  mockDispatch.mockResolvedValue({
    nodes: locationPermissionNodes,
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 4, maxDepth: 1 },
  });

  const response = await runWaitCommand(sessionName, androidDevice, ['Receipt uploaded', '0']);

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.message).toBe(
      'wait timed out for text: Receipt uploaded. Current surface: Location permission, Allow location access?, Not now, Continue.',
    );
    expect(response.error.details?.currentSurface).toEqual({
      labels: ['Location permission', 'Allow location access?', 'Not now', 'Continue'],
      buttons: ['Not now', 'Continue'],
    });
  }
});

test('wait selector timeout includes compact current-surface details', async () => {
  const sessionName = 'android-wait-selector-timeout-surface';
  mockDispatch.mockResolvedValue({
    nodes: locationRequiredNodes,
    truncated: false,
    backend: 'android',
    analysis: { rawNodeCount: 2, maxDepth: 0 },
  });

  const response = await runWaitCommand(sessionName, androidDevice, ['id=receipt-uploaded', '0']);

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.message).toBe(
      'wait timed out for selector: id=receipt-uploaded. Current surface: Location required, Dismiss.',
    );
    expect(response.error.details?.currentSurface).toEqual({
      labels: ['Location required', 'Dismiss'],
      buttons: ['Dismiss'],
    });
  }
});

test('wait timeout summary prefers content labels over chrome and identifier noise', async () => {
  const sessionName = 'ios-wait-timeout-surface-summary';
  mockRunnerCommand.mockResolvedValue({ found: false });
  mockDispatch.mockResolvedValue({
    nodes: iosSurfaceSummaryNodes,
    truncated: false,
    backend: 'xctest',
  });

  const response = await runWaitCommand(sessionName, iosSimulatorDevice, [
    'Impossible success text',
    '0',
  ]);

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.message).toBe(
      'wait timed out for text: Impossible success text. Current surface: Confirm catalog refresh, Keep browsing.',
    );
    expect(response.error.details?.currentSurface).toEqual({
      labels: [
        'Confirm catalog refresh',
        'Keep browsing',
        'host.exp.exponent:id/reload_button',
        'Expo Go',
        'gearshape.fill',
        'Tab Bar',
      ],
      buttons: ['Keep browsing', 'host.exp.exponent:id/reload_button'],
    });
  }
});

test('wait timeout preserves current behavior when current-surface inspection fails', async () => {
  const sessionName = 'android-wait-timeout-surface-fails';
  mockDispatch.mockRejectedValue(new Error('snapshot unavailable'));

  const response = await runWaitCommand(sessionName, androidDevice, ['Receipt uploaded', '0']);

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.message).toBe('wait timed out for text: Receipt uploaded');
    expect(response.error.details).toBeUndefined();
  }
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
