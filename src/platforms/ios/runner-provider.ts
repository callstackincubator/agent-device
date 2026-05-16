import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RunnerCommand } from './runner-contract.ts';

export type AppleRunnerCommandOptions = {
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  requestId?: string;
};

export type AppleRunnerCommandExecutor = (
  device: DeviceInfo,
  command: RunnerCommand,
  options: AppleRunnerCommandOptions,
) => Promise<Record<string, unknown>>;

export type AppleRunnerProvider = {
  /**
   * Executes a runner protocol command for an already resolved Apple target.
   * Scoped providers may adapt this call to a request-local transport.
   */
  runCommand: AppleRunnerCommandExecutor;
};

export type AppleRunnerProviderScopeOptions = {
  deviceId: string;
  requestId?: string;
};

type AppleRunnerProviderScope = {
  provider: AppleRunnerProvider;
  deviceId: string;
  requestId?: string;
};

const appleRunnerProviderScope = new AsyncLocalStorage<AppleRunnerProviderScope>();

export function createLocalAppleRunnerProvider(
  runCommand: AppleRunnerCommandExecutor,
): AppleRunnerProvider {
  return { runCommand };
}

export function resolveAppleRunnerProvider(
  device: DeviceInfo,
  fallback: AppleRunnerProvider | AppleRunnerCommandExecutor,
  provider?: AppleRunnerProvider | AppleRunnerCommandExecutor,
  options: { requestId?: string } = {},
): AppleRunnerProvider {
  if (provider) return normalizeAppleRunnerProvider(provider);
  const scoped = appleRunnerProviderScope.getStore();
  return scoped &&
    scoped.deviceId === device.id &&
    (scoped.requestId ? scoped.requestId === options.requestId : !options.requestId)
    ? normalizeAppleRunnerProvider(scoped.provider)
    : normalizeAppleRunnerProvider(fallback);
}

export async function withAppleRunnerProvider<T>(
  provider: AppleRunnerProvider | AppleRunnerCommandExecutor | undefined,
  options: AppleRunnerProviderScopeOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return await fn();
  const scope = {
    provider: normalizeAppleRunnerProvider(provider),
    deviceId: options.deviceId,
    requestId: options.requestId,
  };
  return await appleRunnerProviderScope.run(scope, fn);
}

function normalizeAppleRunnerProvider(
  provider: AppleRunnerProvider | AppleRunnerCommandExecutor,
): AppleRunnerProvider {
  if (typeof provider === 'function') {
    return { runCommand: provider };
  }
  return provider;
}
