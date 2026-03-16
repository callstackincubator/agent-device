import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleInstallFromSourceCommand } from '../install-source.ts';
import { resolveInstallSource } from '../../install-source-resolution.ts';
import { SessionStore } from '../../session-store.ts';
import { trackUploadedArtifact } from '../../upload-registry.ts';
import type { DaemonRequest, SessionState } from '../../types.ts';

function makeRequest(meta?: DaemonRequest['meta']): DaemonRequest {
  return {
    token: 't',
    session: 'default',
    command: 'install_source',
    positionals: [],
    flags: { platform: 'android' },
    meta,
  };
}

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-install-source-session-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeAndroidSession(name: string): SessionState {
  return {
    name,
    createdAt: Date.now(),
    actions: [],
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  };
}

test('resolveInstallSource uses uploaded artifact path for uploaded path sources', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-install-source-upload-'));
  const artifactPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(artifactPath, 'apk-binary');
  const uploadedArtifactId = trackUploadedArtifact({ artifactPath, tempDir: tempRoot });

  const resolved = resolveInstallSource(makeRequest({
    uploadedArtifactId,
    installSource: {
      kind: 'path',
      path: '/Users/dev/Downloads/Sample.apk',
    },
  }));

  assert.equal(resolved.source.kind, 'path');
  assert.equal(resolved.source.path, artifactPath);

  resolved.cleanup();
  assert.equal(fs.existsSync(tempRoot), false);
});

test('resolveInstallSource leaves URL sources unchanged even when upload metadata exists', () => {
  const resolved = resolveInstallSource(makeRequest({
    uploadedArtifactId: 'upload-123',
    installSource: {
      kind: 'url',
      url: 'https://example.com/app.apk',
      headers: {},
    },
  }));

  assert.deepEqual(resolved.source, {
    kind: 'url',
    url: 'https://example.com/app.apk',
    headers: {},
  });
  resolved.cleanup();
});

test('install_from_source returns Android package identity resolved after install when artifact inspection is empty', async () => {
  const sessionStore = makeSessionStore();
  const session = makeAndroidSession('default');
  sessionStore.set(session.name, session);

  const response = await handleInstallFromSourceCommand({
    req: makeRequest({
      installSource: {
        kind: 'url',
        url: 'https://example.com/app.zip',
        headers: {},
      },
    }),
    sessionName: session.name,
    sessionStore,
    deps: {
      resolveInstallDevice: async () => session.device,
      prepareAndroidInstallArtifact: async () => ({
        installablePath: '/tmp/materialized/app.apk',
        packageName: undefined,
        cleanup: async () => {},
      }),
      installAndroidInstallablePathAndResolvePackageName: async () => 'com.example.app',
      inferAndroidAppName: () => 'App',
    },
  });

  assert.deepEqual(response, {
    ok: true,
    data: {
      packageName: 'com.example.app',
      appName: 'App',
      launchTarget: 'com.example.app',
    },
  });
  assert.deepEqual(session.actions.at(-1)?.result, {
    packageName: 'com.example.app',
    appName: 'App',
    launchTarget: 'com.example.app',
  });
});

test('install_from_source returns an error when Android package identity cannot be resolved', async () => {
  const sessionStore = makeSessionStore();
  const session = makeAndroidSession('default');
  sessionStore.set(session.name, session);

  const response = await handleInstallFromSourceCommand({
    req: makeRequest({
      installSource: {
        kind: 'url',
        url: 'https://example.com/app.zip',
        headers: {},
      },
    }),
    sessionName: session.name,
    sessionStore,
    deps: {
      resolveInstallDevice: async () => session.device,
      prepareAndroidInstallArtifact: async () => ({
        installablePath: '/tmp/materialized/app.apk',
        packageName: undefined,
        cleanup: async () => {},
      }),
      installAndroidInstallablePathAndResolvePackageName: async () => undefined,
      inferAndroidAppName: () => 'App',
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, 'COMMAND_FAILED');
  assert.match(response.error?.message ?? '', /identity could not be resolved/i);
});
