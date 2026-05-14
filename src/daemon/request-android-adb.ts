import {
  type AndroidAdbExecutor,
  type AndroidAdbProvider,
  withAndroidAdbProvider,
} from '../platforms/android/adb-executor.ts';
import { resolveTargetDevice } from '../core/dispatch-resolve.ts';
import type { DeviceInfo } from '../utils/device.ts';
import { hasExplicitDeviceSelector } from './handlers/session-device-utils.ts';
import type { DaemonRequest, SessionState } from './types.ts';

export type AndroidAdbProviderRequestSession = Pick<
  SessionState,
  'name' | 'device' | 'appBundleId' | 'appName' | 'surface'
>;

export type AndroidAdbProviderResolver = (params: {
  req: DaemonRequest;
  device: DeviceInfo;
  session?: AndroidAdbProviderRequestSession;
}) => AndroidAdbProvider | AndroidAdbExecutor | undefined;

async function resolveScopedAndroidAdbProvider(params: {
  req: DaemonRequest;
  existingSession: SessionState | undefined;
  androidAdbProvider?: AndroidAdbProviderResolver;
}): Promise<{
  provider?: AndroidAdbProvider | AndroidAdbExecutor;
  executor?: AndroidAdbExecutor;
  serial?: string;
}> {
  const { req, existingSession, androidAdbProvider } = params;
  if (!androidAdbProvider) return {};
  const device = await resolveAndroidAdbProviderDevice(req, existingSession);
  if (!device) return {};
  const provider = androidAdbProvider({ req, device, session: existingSession });
  const executor = typeof provider === 'function' ? provider : provider?.exec;
  return { provider, executor, serial: device.id };
}

export async function withRequestAndroidAdbScope<T>(
  params: {
    req: DaemonRequest;
    existingSession: SessionState | undefined;
    androidAdbProvider?: AndroidAdbProviderResolver;
  },
  task: (executor?: AndroidAdbExecutor) => Promise<T>,
): Promise<T> {
  const requestAdb = await resolveScopedAndroidAdbProvider({
    req: params.req,
    existingSession: params.existingSession,
    androidAdbProvider: params.androidAdbProvider,
  });
  return await withAndroidAdbProvider(
    requestAdb.provider,
    { serial: requestAdb.serial ?? '' },
    async () => await task(requestAdb.executor),
  );
}

async function resolveAndroidAdbProviderDevice(
  req: DaemonRequest,
  existingSession: SessionState | undefined,
): Promise<DeviceInfo | undefined> {
  if (existingSession) {
    return existingSession.device.platform === 'android' ? existingSession.device : undefined;
  }
  if (req.command !== 'open' && !hasExplicitDeviceSelector(req.flags)) {
    return undefined;
  }
  const device = await resolveTargetDevice(req.flags ?? {});
  return device.platform === 'android' ? device : undefined;
}
