import { beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})) };
});

import { dispatchCommand } from '../../core/dispatch.ts';
import { makeIosSession } from '../../__tests__/test-utils/session-factories.ts';
import { makeSessionStore } from '../../__tests__/test-utils/store-factory.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { createRequestHandler } from '../request-router.ts';

const mockDispatch = vi.mocked(dispatchCommand);

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
});

test('replay runs active-session actions inside the parent request provider scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-scope-'));
  const replayPath = path.join(root, 'flow.ad');
  fs.writeFileSync(replayPath, 'home\nback\n');
  const sessionStore = makeSessionStore('agent-device-replay-scope-');
  sessionStore.set('default', makeIosSession('default', { appBundleId: 'com.example.app' }));
  const appleRunnerProvider = vi.fn(() => undefined);

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    appleRunnerProvider,
    trackDownloadableArtifact: () => 'artifact-id',
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'replay',
    positionals: [replayPath],
    meta: { cwd: root, requestId: 'replay-scope-1', sessionExplicit: true },
  });

  expect(response).toMatchObject({ ok: true });
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(appleRunnerProvider).toHaveBeenCalledTimes(1);
});

test('replay routes session-changing actions through the full request path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-full-route-'));
  const replayPath = path.join(root, 'flow.ad');
  fs.writeFileSync(replayPath, 'runtime set --platform ios --metro-host localhost\nhome\n');
  const sessionStore = makeSessionStore('agent-device-replay-full-route-');
  sessionStore.set('default', makeIosSession('default', { appBundleId: 'com.example.app' }));
  const appleRunnerProvider = vi.fn(() => undefined);

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    appleRunnerProvider,
    trackDownloadableArtifact: () => 'artifact-id',
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'replay',
    positionals: [replayPath],
    meta: { cwd: root, requestId: 'replay-scope-2', sessionExplicit: true },
  });

  expect(response).toMatchObject({ ok: true });
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(appleRunnerProvider).toHaveBeenCalledTimes(2);
});
