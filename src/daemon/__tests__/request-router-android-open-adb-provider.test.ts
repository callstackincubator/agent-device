import { expect, test, vi } from 'vitest';
import { getResolveTargetDeviceMock } from './request-router-dispatch-mocks.ts';

vi.mock('../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));

import { dispatchCommand } from '../../core/dispatch.ts';
import { runCmd } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { createRequestHandler } from '../request-router.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { makeSessionStore } from '../../__tests__/test-utils/store-factory.ts';

const androidDevice: DeviceInfo = {
  platform: 'android',
  id: 'remote-android-1',
  name: 'Remote Android',
  kind: 'device',
  target: 'mobile',
  booted: true,
};

test('router scopes first Android open request through injected adb provider', async () => {
  vi.mocked(getResolveTargetDeviceMock()).mockResolvedValue(androidDevice);
  vi.mocked(dispatchCommand).mockImplementationOnce(async (device) => {
    await runCmd('adb', ['-s', device.id, 'shell', 'am', 'start', 'com.example.app']);
    return {};
  });
  const adbCalls: string[][] = [];
  const providerCalls: Array<{ device: DeviceInfo; hasSession: boolean }> = [];

  const handler = createRequestHandler({
    logPath: '/tmp/daemon.log',
    token: 'token',
    sessionStore: makeSessionStore('agent-device-router-open-adb-provider-'),
    leaseRegistry: new LeaseRegistry(),
    androidAdbProvider: ({ device, session }) => {
      providerCalls.push({ device, hasSession: Boolean(session) });
      return async (args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      };
    },
    trackDownloadableArtifact: () => 'artifact-id',
  });

  const response = await handler({
    token: 'token',
    session: 'default',
    command: 'open',
    positionals: ['com.example.app'],
    flags: { platform: 'android' },
  });

  expect(response.ok).toBe(true);
  expect(providerCalls).toEqual([{ device: androidDevice, hasSession: false }]);
  expect(adbCalls).toContainEqual(['shell', 'am', 'start', 'com.example.app']);
});
