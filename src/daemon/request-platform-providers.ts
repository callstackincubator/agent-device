import { resolveTargetDevice } from '../core/dispatch-resolve.ts';
import {
  type AndroidAdbExecutor,
  type AndroidAdbProvider,
  withAndroidAdbProvider,
} from '../platforms/android/adb-executor.ts';
import {
  type AppleRunnerCommandExecutor,
  type AppleRunnerProvider,
  withAppleRunnerProvider,
} from '../platforms/ios/runner-provider.ts';
import {
  type AppleToolCommandExecutor,
  type AppleToolProvider,
  withAppleToolProvider,
} from '../platforms/ios/tool-provider.ts';
import { type LinuxToolProvider, withLinuxToolProvider } from '../platforms/linux/tool-provider.ts';
import { isApplePlatform, type DeviceInfo } from '../utils/device.ts';
import { hasExplicitDeviceSelector } from './handlers/session-device-utils.ts';
import type { DaemonRequest, SessionState } from './types.ts';

export type PlatformProviderRequestSession = Pick<
  SessionState,
  'name' | 'device' | 'appBundleId' | 'appName' | 'surface'
>;

export type AndroidAdbProviderResolver = (params: {
  req: DaemonRequest;
  device: DeviceInfo;
  session?: PlatformProviderRequestSession;
}) => AndroidAdbProvider | AndroidAdbExecutor | undefined;

export type AppleRunnerProviderResolver = (params: {
  req: DaemonRequest;
  device: DeviceInfo;
  session?: PlatformProviderRequestSession;
}) => AppleRunnerProvider | AppleRunnerCommandExecutor | undefined;

export type AppleToolProviderResolver = (params: {
  req: DaemonRequest;
  device: DeviceInfo;
  session?: PlatformProviderRequestSession;
}) => AppleToolProvider | AppleToolCommandExecutor | undefined;

export type LinuxToolProviderResolver = (params: {
  req: DaemonRequest;
  device: DeviceInfo;
  session?: PlatformProviderRequestSession;
}) => LinuxToolProvider | undefined;

export type PlatformProviderResolvers = {
  androidAdbProvider?: AndroidAdbProviderResolver;
  appleRunnerProvider?: AppleRunnerProviderResolver;
  appleToolProvider?: AppleToolProviderResolver;
  linuxToolProvider?: LinuxToolProviderResolver;
};

export type RequestPlatformProviderScope = {
  androidAdbExecutor?: AndroidAdbExecutor;
};

type RequestPlatformProviderParams = {
  req: DaemonRequest;
  existingSession: SessionState | undefined;
  providers: PlatformProviderResolvers;
};

type ResolvedRequestPlatformProviders = {
  androidAdb?: {
    provider?: AndroidAdbProvider | AndroidAdbExecutor;
    executor?: AndroidAdbExecutor;
    serial?: string;
  };
  appleRunner?: {
    provider?: AppleRunnerProvider | AppleRunnerCommandExecutor;
    deviceId?: string;
    requestId?: string;
  };
  appleTool?: {
    provider?: AppleToolProvider | AppleToolCommandExecutor;
  };
  linuxTool?: {
    provider?: LinuxToolProvider;
  };
};

type RequestPlatformProviderScopeWrapper = <T>(task: () => Promise<T>) => Promise<T>;

export async function withRequestPlatformProviderScope<T>(
  params: RequestPlatformProviderParams,
  task: (scope: RequestPlatformProviderScope) => Promise<T>,
): Promise<T> {
  const scopedProviders = await resolveRequestPlatformProviders(params);
  const scope: RequestPlatformProviderScope = {
    androidAdbExecutor: scopedProviders.androidAdb?.executor,
  };
  const wrappers = requestPlatformProviderScopeWrappers(scopedProviders);

  return await runRequestPlatformProviderScopes(wrappers, async () => await task(scope));
}

async function resolveRequestPlatformProviders(
  params: RequestPlatformProviderParams,
): Promise<ResolvedRequestPlatformProviders> {
  if (!hasPlatformProviderResolvers(params.providers)) return {};
  const device = await resolveScopedProviderDevice(params.req, params.existingSession);
  if (!device) return {};

  return {
    androidAdb: resolveAndroidAdbProvider(params, device),
    appleRunner: resolveAppleRunnerProvider(params, device),
    appleTool: resolveAppleToolProvider(params, device),
    linuxTool: resolveLinuxToolProvider(params, device),
  };
}

function hasPlatformProviderResolvers(providers: PlatformProviderResolvers): boolean {
  return Boolean(
    providers.androidAdbProvider ||
    providers.appleRunnerProvider ||
    providers.appleToolProvider ||
    providers.linuxToolProvider,
  );
}

function resolveAndroidAdbProvider(
  params: RequestPlatformProviderParams,
  device: DeviceInfo,
): ResolvedRequestPlatformProviders['androidAdb'] {
  const androidAdbProvider = params.providers.androidAdbProvider;
  if (!androidAdbProvider || device.platform !== 'android') return undefined;
  const provider = androidAdbProvider({
    req: params.req,
    device,
    session: params.existingSession,
  });
  const executor = typeof provider === 'function' ? provider : provider?.exec;
  return { provider, executor, serial: device.id };
}

function resolveAppleRunnerProvider(
  params: RequestPlatformProviderParams,
  device: DeviceInfo,
): ResolvedRequestPlatformProviders['appleRunner'] {
  const appleRunnerProvider = params.providers.appleRunnerProvider;
  if (!appleRunnerProvider || !isApplePlatform(device.platform)) return undefined;
  const provider = appleRunnerProvider({
    req: params.req,
    device,
    session: params.existingSession,
  });
  return { provider, deviceId: device.id, requestId: params.req.meta?.requestId };
}

function resolveAppleToolProvider(
  params: RequestPlatformProviderParams,
  device: DeviceInfo,
): ResolvedRequestPlatformProviders['appleTool'] {
  const appleToolProvider = params.providers.appleToolProvider;
  if (!appleToolProvider || !isApplePlatform(device.platform)) return undefined;
  const provider = appleToolProvider({
    req: params.req,
    device,
    session: params.existingSession,
  });
  return { provider };
}

function resolveLinuxToolProvider(
  params: RequestPlatformProviderParams,
  device: DeviceInfo,
): ResolvedRequestPlatformProviders['linuxTool'] {
  const linuxToolProvider = params.providers.linuxToolProvider;
  if (!linuxToolProvider || device.platform !== 'linux') return undefined;
  const provider = linuxToolProvider({
    req: params.req,
    device,
    session: params.existingSession,
  });
  return { provider };
}

async function resolveScopedProviderDevice(
  req: DaemonRequest,
  existingSession: SessionState | undefined,
): Promise<DeviceInfo | undefined> {
  if (existingSession) return existingSession.device;
  if (req.command !== 'open' && !hasExplicitDeviceSelector(req.flags)) return undefined;
  return await resolveTargetDevice(req.flags ?? {});
}

function requestPlatformProviderScopeWrappers(
  scopedProviders: ResolvedRequestPlatformProviders,
): RequestPlatformProviderScopeWrapper[] {
  const wrappers: RequestPlatformProviderScopeWrapper[] = [];

  if (scopedProviders.androidAdb?.provider && scopedProviders.androidAdb.serial) {
    wrappers.push(
      async (task) =>
        await withAndroidAdbProvider(
          scopedProviders.androidAdb?.provider,
          { serial: scopedProviders.androidAdb?.serial ?? '' },
          task,
        ),
    );
  }

  if (scopedProviders.appleRunner?.provider && scopedProviders.appleRunner.deviceId) {
    wrappers.push(
      async (task) =>
        await withAppleRunnerProvider(
          scopedProviders.appleRunner?.provider,
          {
            deviceId: scopedProviders.appleRunner?.deviceId ?? '',
            requestId: scopedProviders.appleRunner?.requestId,
          },
          task,
        ),
    );
  }

  if (scopedProviders.appleTool?.provider) {
    wrappers.push(
      async (task) => await withAppleToolProvider(scopedProviders.appleTool?.provider, task),
    );
  }

  if (scopedProviders.linuxTool?.provider) {
    wrappers.push(
      async (task) => await withLinuxToolProvider(scopedProviders.linuxTool?.provider, task),
    );
  }

  return wrappers;
}

async function runRequestPlatformProviderScopes<T>(
  wrappers: RequestPlatformProviderScopeWrapper[],
  task: () => Promise<T>,
): Promise<T> {
  let run = task;
  for (const wrapper of [...wrappers].reverse()) {
    const next = run;
    run = async () => await wrapper(next);
  }
  return await run();
}
