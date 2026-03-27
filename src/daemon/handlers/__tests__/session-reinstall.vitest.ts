import { test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})), resolveTargetDevice: vi.fn() };
});
vi.mock('../../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { trackUploadedArtifact } from '../../upload-registry.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import { resolveTargetDevice } from '../../../core/dispatch.ts';
import { ensureDeviceReady } from '../../device-ready.ts';

const mockResolveTargetDevice = vi.mocked(resolveTargetDevice);
const mockEnsureDeviceReady = vi.mocked(ensureDeviceReady);

beforeEach(() => {
  mockResolveTargetDevice.mockReset();
  mockEnsureDeviceReady.mockReset();
  mockEnsureDeviceReady.mockResolvedValue(undefined);
});

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-app-deploy-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

const invoke = async (_req: DaemonRequest): Promise<DaemonResponse> => {
  return {
    ok: false,
    error: { code: 'INVALID_ARGS', message: 'invoke should not be called in app deploy tests' },
  };
};

test('reinstall requires active session or explicit device selector', async () => {
  const sessionStore = makeStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', '/tmp/app.apk'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });
  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(false);
  if (!response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/active session or an explicit device selector/i);
  }
});

test('reinstall validates required args before device operations', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone',
    kind: 'simulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });
  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(false);
  if (!response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/reinstall <app> <path-to-app-binary>/i);
  }
});

test('reinstall succeeds on active iOS physical device session', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'ios',
    id: 'device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-reinstall-binary-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    reinstallOps: {
      ios: async (_device, app, pathToBinary) => {
        expect(app).toBe('com.example.app');
        expect(pathToBinary).toBe(appPath);
        return { bundleId: 'com.example.app' };
      },
      android: async () => {
        throw new Error('unexpected android reinstall');
      },
    },
  });
  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.platform).toBe('ios');
    expect(response.data?.appId).toBe('com.example.app');
    expect(response.data?.bundleId).toBe('com.example.app');
    expect(response.data?.appPath).toBe(appPath);
    expect(response.data?.archivePath).toBeUndefined();
    expect(response.data?.installablePath).toBeUndefined();
  }
});

test('reinstall succeeds on active iOS simulator session and records action', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone',
    kind: 'simulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-reinstall-success-ios-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    reinstallOps: {
      ios: async (_device, app, pathToBinary) => {
        expect(app).toBe('com.example.app');
        expect(pathToBinary).toBe(appPath);
        return { bundleId: 'com.example.app' };
      },
      android: async () => {
        throw new Error('unexpected android reinstall');
      },
    },
  });

  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.platform).toBe('ios');
    expect(response.data?.appId).toBe('com.example.app');
    expect(response.data?.bundleId).toBe('com.example.app');
    expect(response.data?.appPath).toBe(appPath);
    expect(response.data?.archivePath).toBeUndefined();
    expect(response.data?.installablePath).toBeUndefined();
  }
  expect(session.actions.length).toBe(1);
  expect(session.actions[0]?.command).toBe('reinstall');
});

test('reinstall succeeds on active Android session with normalized appId', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-device-reinstall-success-android-'),
  );
  const appPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    reinstallOps: {
      ios: async () => {
        throw new Error('unexpected ios reinstall');
      },
      android: async (_device, app, pathToBinary) => {
        expect(app).toBe('com.example.app');
        expect(pathToBinary).toBe(appPath);
        return { package: 'com.example.app' };
      },
    },
  });

  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.platform).toBe('android');
    expect(response.data?.appId).toBe('com.example.app');
    expect(response.data?.package).toBe('com.example.app');
    expect(response.data?.appPath).toBe(appPath);
    expect(response.data?.archivePath).toBeUndefined();
    expect(response.data?.installablePath).toBeUndefined();
  }
});

test('install requires active session or explicit device selector', async () => {
  const sessionStore = makeStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'install',
      positionals: ['com.example.app', '/tmp/app.apk'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });
  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(false);
  if (!response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/active session or an explicit device selector/i);
  }
});

test('install succeeds on active iOS simulator session and records action', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone',
    kind: 'simulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-install-success-ios-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'install',
      positionals: ['com.example.app', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    installOps: {
      ios: async (_device, app, pathToBinary) => {
        expect(app).toBe('com.example.app');
        expect(pathToBinary).toBe(appPath);
        return { bundleId: 'com.example.app' };
      },
      android: async () => {
        throw new Error('unexpected android install');
      },
    },
  });

  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.platform).toBe('ios');
    expect(response.data?.appId).toBe('com.example.app');
    expect(response.data?.bundleId).toBe('com.example.app');
    expect(response.data?.appPath).toBe(appPath);
    expect(response.data?.archivePath).toBeUndefined();
    expect(response.data?.installablePath).toBeUndefined();
  }
  expect(session.actions.length).toBe(1);
  expect(session.actions[0]?.command).toBe('install');
});

test('install omits app id fields when platform op cannot resolve them', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-install-fallback-appid-'));
  const appPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'install',
      positionals: ['Demo', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    installOps: {
      ios: async () => {
        throw new Error('unexpected ios install');
      },
      android: async () => ({}),
    },
  });

  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.platform).toBe('android');
    expect(response.data?.appId).toBeUndefined();
    expect(response.data?.package).toBeUndefined();
    expect(response.data?.appPath).toBe(appPath);
    expect(response.data?.archivePath).toBeUndefined();
    expect(response.data?.installablePath).toBeUndefined();
  }
});

test('reinstall resolves uploaded artifacts by id and cleans temp files after completion', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone',
    kind: 'simulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-uploaded-artifact-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(appPath, 'placeholder');
  const uploadedArtifactId = trackUploadedArtifact({ artifactPath: appPath, tempDir: tempRoot });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', '/Users/dev/Downloads/Sample.app'],
      flags: {},
      meta: { uploadedArtifactId },
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    reinstallOps: {
      ios: async (_device, app, pathToBinary) => {
        expect(app).toBe('com.example.app');
        expect(pathToBinary).toBe(appPath);
        return { bundleId: 'com.example.app' };
      },
      android: async () => {
        throw new Error('unexpected android reinstall');
      },
    },
  });

  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
  expect(fs.existsSync(tempRoot)).toBe(false);
});
