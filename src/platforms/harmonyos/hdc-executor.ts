import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeviceInfo } from '../../utils/device.ts';
import {
  runCmd,
  withCommandExecutorOverride,
  withoutCommandExecutorOverride,
  type CommandExecutorOverride,
  type ExecOptions,
  type ExecResult,
} from '../../utils/exec.ts';

export type HarmonyHdcExecutorOptions = Pick<
  ExecOptions,
  'allowFailure' | 'timeoutMs' | 'binaryStdout' | 'stdin' | 'signal'
>;

export type HarmonyHdcExecutorResult = Pick<
  ExecResult,
  'exitCode' | 'stdout' | 'stderr' | 'stdoutBuffer'
>;

/**
 * Runs device-scoped hdc arguments after the device serial has been selected.
 */
export type HarmonyHdcExecutor = (
  args: string[],
  options?: HarmonyHdcExecutorOptions,
) => Promise<HarmonyHdcExecutorResult>;

export type HarmonyHdcProvider = {
  exec: HarmonyHdcExecutor;
};

export type HarmonyHdcProviderScopeOptions = {
  serial: string;
};

type HarmonyHdcProviderScope = {
  provider: HarmonyHdcProvider;
  serial: string;
};

const harmonyHdcProviderScope = new AsyncLocalStorage<HarmonyHdcProviderScope>();

export function createDeviceHdcExecutor(device: DeviceInfo): HarmonyHdcExecutor {
  return createSerialHdcExecutor(device.id);
}

function createSerialHdcExecutor(serial: string): HarmonyHdcExecutor {
  return async (args, options) =>
    await withoutCommandExecutorOverride(
      async () => await runCmd('hdc', ['-t', serial, ...args], options),
    );
}

export function createLocalHarmonyHdcProvider(device: DeviceInfo): HarmonyHdcProvider {
  return {
    exec: createDeviceHdcExecutor(device),
  };
}

export function resolveHarmonyHdcExecutor(
  device: DeviceInfo,
  executor?: HarmonyHdcExecutor,
): HarmonyHdcExecutor {
  const scoped = harmonyHdcProviderScope.getStore();
  if (executor) return executor;
  if (scoped?.serial === device.id) return scoped.provider.exec;
  return createDeviceHdcExecutor(device);
}

export function resolveHarmonyHdcProvider(
  device: DeviceInfo,
  provider?: HarmonyHdcProvider | HarmonyHdcExecutor,
): HarmonyHdcProvider {
  if (provider) return normalizeHarmonyHdcProvider(provider);
  const scoped = harmonyHdcProviderScope.getStore();
  return scoped?.serial === device.id
    ? normalizeHarmonyHdcProvider(scoped.provider)
    : createLocalHarmonyHdcProvider(device);
}

export async function withHarmonyHdcProvider<T>(
  provider: HarmonyHdcProvider | HarmonyHdcExecutor | undefined,
  options: HarmonyHdcProviderScopeOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return await fn();
  const normalized = typeof provider === 'function' ? { exec: provider } : provider;
  const scope = { provider: normalized, serial: options.serial };
  const override = createHarmonyCommandExecutorOverride(scope);
  return await harmonyHdcProviderScope.run(
    scope,
    async () => await withCommandExecutorOverride(override, fn),
  );
}

function createHarmonyCommandExecutorOverride(
  scope: HarmonyHdcProviderScope,
): CommandExecutorOverride {
  return (cmd, args, options) => {
    if (cmd !== 'hdc') return undefined;
    const providerArgs = stripHdcSerialArgs(args, scope.serial);
    if (!providerArgs) return undefined;
    return withoutCommandExecutorOverride(
      async () => await scope.provider.exec(providerArgs, options),
    );
  };
}

function stripHdcSerialArgs(args: string[], expectedSerial: string): string[] | undefined {
  if (args[0] !== '-t' || !args[1]) return undefined;
  if (args[1] !== expectedSerial) return undefined;
  return args.slice(2);
}

function normalizeHarmonyHdcProvider(
  provider: HarmonyHdcProvider | HarmonyHdcExecutor,
): HarmonyHdcProvider {
  if (typeof provider === 'function') {
    return { exec: provider };
  }
  return provider;
}
