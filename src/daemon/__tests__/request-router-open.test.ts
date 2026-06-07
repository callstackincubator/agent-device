import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getResolveTargetDeviceMock } from './request-router-dispatch-mocks.ts';

vi.mock('../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));

import { dispatchCommand } from '../../core/dispatch.ts';
import { createRequestHandler } from '../request-router.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { makeSessionStore } from '../../__tests__/test-utils/store-factory.ts';

const mockDispatch = vi.mocked(dispatchCommand);
const mockResolveTargetDevice = vi.mocked(getResolveTargetDeviceMock());
const mockEnsureDeviceReady = vi.mocked(ensureDeviceReady);

function makeIosDevice(id: string): DeviceInfo {
  return {
    platform: 'ios',
    id,
    name: `iPhone ${id}`,
    kind: 'simulator',
    target: 'mobile',
    booted: true,
  };
}

function createOpenHandler(sessionStore: ReturnType<typeof makeSessionStore>) {
  return createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });
}

function openRequest(session: string, flags: Record<string, unknown>, requestId: string) {
  return {
    token: 'test-token',
    session,
    command: 'open',
    positionals: [],
    flags,
    meta: { requestId },
  };
}

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
  mockResolveTargetDevice.mockReset();
  mockEnsureDeviceReady.mockReset();
  mockEnsureDeviceReady.mockResolvedValue(undefined);
});

test('open returns and creates the session state directory', async () => {
  const sessionStore = makeSessionStore('agent-device-router-open-');
  const device = makeIosDevice('SIM-STATE');
  mockResolveTargetDevice.mockResolvedValue(device);

  const handler = createOpenHandler(sessionStore);

  const response = await handler(openRequest('session-a', { platform: 'ios' }, 'req-open-state'));

  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.data?.session).toBe('session-a');
    expect(response.data?.sessionStateDir).toEqual(expect.stringContaining('session-a'));
    expect(response.data?.runnerLogPath).toEqual(
      path.join(String(response.data?.sessionStateDir), 'runner.log'),
    );
    expect(response.data?.requestLogPath).toEqual(
      path.join(String(response.data?.sessionStateDir), 'requests', 'req-open-state.ndjson'),
    );
    expect(fs.existsSync(String(response.data?.sessionStateDir))).toBe(true);
  }
});

test('router serializes same-device open requests before first session creation finishes', async () => {
  const sessionStore = makeSessionStore('agent-device-router-open-');
  const sameDevice = makeIosDevice('SIM-001');
  const resolutionPlan: Array<DeviceInfo | AppError> = [
    new AppError('DEVICE_NOT_FOUND', 'device discovery is still warming up'),
    sameDevice,
    new AppError('DEVICE_NOT_FOUND', 'device discovery is still warming up'),
    sameDevice,
  ];
  mockResolveTargetDevice.mockImplementation(async () => {
    const next = resolutionPlan.shift();
    if (!next) {
      throw new Error('Unexpected resolveTargetDevice call');
    }
    if (next instanceof AppError) {
      throw next;
    }
    return next;
  });

  let ensureCalls = 0;
  let activeEnsures = 0;
  let maxActiveEnsures = 0;
  let releaseFirstEnsure: (() => void) | undefined;
  mockEnsureDeviceReady.mockImplementation(async () => {
    ensureCalls += 1;
    activeEnsures += 1;
    maxActiveEnsures = Math.max(maxActiveEnsures, activeEnsures);
    if (ensureCalls === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstEnsure = () => {
          activeEnsures -= 1;
          resolve();
        };
      });
      return;
    }
    activeEnsures -= 1;
  });

  const handler = createOpenHandler(sessionStore);

  const firstOpen = handler(openRequest('session-a', { platform: 'ios' }, 'req-open-1'));

  await vi.waitFor(() => {
    expect(ensureCalls).toBe(1);
  });

  const secondOpen = handler(
    openRequest('session-b', { platform: 'ios', udid: 'SIM-001' }, 'req-open-2'),
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ensureCalls).toBe(1);
  expect(maxActiveEnsures).toBe(1);

  releaseFirstEnsure?.();

  const [firstResponse, secondResponse] = await Promise.all([firstOpen, secondOpen]);

  expect(firstResponse.ok).toBe(true);
  expect(secondResponse.ok).toBe(false);
  if (!secondResponse.ok) {
    expect(secondResponse.error.code).toBe('DEVICE_IN_USE');
  }
  expect(maxActiveEnsures).toBe(1);
});

test('router allows pre-open requests for different devices to proceed concurrently', async () => {
  const sessionStore = makeSessionStore('agent-device-router-open-');
  const deviceA = makeIosDevice('SIM-001');
  const deviceB = makeIosDevice('SIM-002');
  mockResolveTargetDevice.mockImplementation(async (flags) => {
    if (flags.udid === 'SIM-001') {
      return deviceA;
    }
    if (flags.udid === 'SIM-002') {
      return deviceB;
    }
    throw new Error(`Unexpected UDID ${String(flags.udid)}`);
  });

  let ensureCalls = 0;
  let activeEnsures = 0;
  let maxActiveEnsures = 0;
  const releases: Array<() => void> = [];
  mockEnsureDeviceReady.mockImplementation(async () => {
    ensureCalls += 1;
    activeEnsures += 1;
    maxActiveEnsures = Math.max(maxActiveEnsures, activeEnsures);
    await new Promise<void>((resolve) => {
      releases.push(() => {
        activeEnsures -= 1;
        resolve();
      });
    });
  });

  const handler = createOpenHandler(sessionStore);

  const firstOpen = handler(
    openRequest('session-a', { platform: 'ios', udid: 'SIM-001' }, 'req-open-a'),
  );
  const secondOpen = handler(
    openRequest('session-b', { platform: 'ios', udid: 'SIM-002' }, 'req-open-b'),
  );

  await vi.waitFor(() => {
    expect(ensureCalls).toBe(2);
  });

  expect(maxActiveEnsures).toBe(2);
  releases.splice(0).forEach((release) => release());

  const [firstResponse, secondResponse] = await Promise.all([firstOpen, secondOpen]);

  expect(firstResponse.ok).toBe(true);
  expect(secondResponse.ok).toBe(true);
  expect(maxActiveEnsures).toBe(2);
});
