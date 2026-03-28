import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})) };
});

import { dispatchCommand } from '../../core/dispatch.ts';
import { createRequestHandler } from '../request-router.ts';
import { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { attachRefs } from '../../utils/snapshot.ts';
import { PNG } from 'pngjs';

const mockDispatch = vi.mocked(dispatchCommand);

const ANDROID_DEVICE: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-router-screenshot-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeSession(name: string): SessionState {
  return {
    name,
    device: ANDROID_DEVICE,
    createdAt: Date.now(),
    actions: [],
  };
}

function makeMacOsMenubarSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
    surface: 'menubar',
    appBundleId: 'com.example.menubarapp',
  };
}

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
});

function writeSolidPng(filePath: string, width = 100, height = 50): void {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 255;
    png.data[index + 1] = 255;
    png.data[index + 2] = 255;
    png.data[index + 3] = 255;
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

test('screenshot resolves relative positional path against request cwd', async () => {
  const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-screenshot-cwd-caller-'));
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));

  let capturedPath: string | undefined;
  mockDispatch.mockImplementation(async (_device, command, positionals) => {
    if (command === 'screenshot') {
      capturedPath = positionals[0];
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: ['evidence/test.png'],
    meta: { cwd: callerCwd, requestId: 'req-1' },
  });

  expect(capturedPath).toBeTruthy();
  expect(capturedPath).toBe(path.join(callerCwd, 'evidence/test.png'));
  expect(path.isAbsolute(capturedPath!)).toBe(true);
  const recordedAction = sessionStore.get('default')?.actions.at(-1);
  expect(recordedAction?.positionals).toEqual([path.join(callerCwd, 'evidence/test.png')]);
});

test('screenshot forwards macOS session surface to dispatch', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeMacOsMenubarSession('default'));

  mockDispatch.mockImplementation(async () => ({}));

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: ['/tmp/menubar.png'],
    meta: { requestId: 'req-surface-screenshot' },
  });

  expect(mockDispatch.mock.calls[0]?.[4]).toMatchObject({
    surface: 'menubar',
    appBundleId: 'com.example.menubarapp',
  });
});

test('click forwards macOS menubar session surface to dispatch', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeMacOsMenubarSession('default'));

  mockDispatch.mockImplementation(async () => ({}));

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'click',
    positionals: ['100', '200'],
    meta: { requestId: 'req-surface-click' },
  });

  expect(mockDispatch.mock.calls[0]?.[1]).toBe('press');
  expect(mockDispatch.mock.calls[0]?.[4]).toMatchObject({
    surface: 'menubar',
    appBundleId: 'com.example.menubarapp',
  });
});

test('screenshot keeps absolute positional path unchanged', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));

  const absolutePath = path.join(os.tmpdir(), 'evidence/test.png');
  let capturedPath: string | undefined;

  mockDispatch.mockImplementation(async (_device, command, positionals) => {
    if (command === 'screenshot') {
      capturedPath = positionals[0];
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: [absolutePath],
    meta: { cwd: '/some/other/dir', requestId: 'req-2' },
  });

  expect(capturedPath).toBe(absolutePath);
  const recordedAction = sessionStore.get('default')?.actions.at(-1);
  expect(recordedAction?.positionals).toEqual([absolutePath]);
});

test('screenshot resolves --out flag path against request cwd', async () => {
  const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-screenshot-out-cwd-'));
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));

  let capturedOut: string | undefined;

  mockDispatch.mockImplementation(async (_device, command, _positionals, outPath) => {
    if (command === 'screenshot') {
      capturedOut = outPath;
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: [],
    flags: { out: 'evidence/test.png' },
    meta: { cwd: callerCwd, requestId: 'req-3' },
  });

  expect(capturedOut).toBeTruthy();
  expect(capturedOut).toBe(path.join(callerCwd, 'evidence/test.png'));
  expect(path.isAbsolute(capturedOut!)).toBe(true);
  const recordedAction = sessionStore.get('default')?.actions.at(-1);
  expect(recordedAction?.flags.out).toBe(path.join(callerCwd, 'evidence/test.png'));
});

test('screenshot --overlay-refs captures a fresh snapshot when the session has none', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));
  const screenshotPath = path.join(os.tmpdir(), `agent-device-overlay-${Date.now()}.png`);

  mockDispatch.mockImplementation(async (_device, command) => {
    if (command === 'screenshot') {
      writeSolidPng(screenshotPath);
      return { path: screenshotPath };
    }
    if (command === 'snapshot') {
      return {
        nodes: [
          {
            index: 0,
            type: 'XCUIElementTypeButton',
            label: 'Continue',
            hittable: true,
            rect: { x: 0, y: 0, width: 40, height: 20 },
          },
        ],
      };
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: [screenshotPath],
    flags: { overlayRefs: true },
    meta: { requestId: 'req-overlay-missing-snapshot' },
  });

  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.overlayRefs).toEqual([
      {
        ref: 'e1',
        label: 'Continue',
        rect: { x: 0, y: 0, width: 40, height: 20 },
        overlayRect: { x: 0, y: 0, width: 100, height: 50 },
        center: { x: 50, y: 25 },
      },
    ]);
  }
  expect(mockDispatch.mock.calls.map((call) => call[1])).toEqual(['screenshot', 'snapshot']);
});

test('screenshot --overlay-refs uses a fresh snapshot instead of stale session snapshot', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default');
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeButton',
        label: 'Stale',
        hittable: true,
        rect: { x: 0, y: 0, width: 40, height: 20 },
      },
    ]),
    createdAt: Date.now(),
  };
  sessionStore.set('default', session);

  const screenshotPath = path.join(os.tmpdir(), `agent-device-overlay-${Date.now()}.png`);
  mockDispatch.mockImplementation(async (_device, command) => {
    if (command === 'screenshot') {
      writeSolidPng(screenshotPath);
      return { path: screenshotPath };
    }
    if (command === 'snapshot') {
      return {
        nodes: [
          {
            index: 0,
            type: 'XCUIElementTypeButton',
            label: 'Fresh',
            hittable: true,
            rect: { x: 0, y: 0, width: 40, height: 20 },
          },
        ],
      };
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: [screenshotPath],
    flags: { overlayRefs: true },
    meta: { requestId: 'req-overlay-ok' },
  });

  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.path).toBe(screenshotPath);
    expect(response.data?.overlayRefs).toEqual([
      {
        ref: 'e1',
        label: 'Fresh',
        rect: { x: 0, y: 0, width: 40, height: 20 },
        overlayRect: { x: 0, y: 0, width: 100, height: 50 },
        center: { x: 50, y: 25 },
      },
    ]);
  }
  expect(sessionStore.get('default')?.snapshot?.nodes[0]?.label).toBe('Fresh');
  const png = PNG.sync.read(fs.readFileSync(screenshotPath));
  expect(Array.from(png.data.slice(0, 4))).not.toEqual([255, 255, 255, 255]);
});
