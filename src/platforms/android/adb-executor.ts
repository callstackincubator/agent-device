import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { DeviceInfo } from '../../utils/device.ts';
import {
  runCmd,
  withCommandExecutorOverride,
  withoutCommandExecutorOverride,
  type CommandExecutorOverride,
  type ExecOptions,
  type ExecResult,
} from '../../utils/exec.ts';

export type AndroidAdbExecutorOptions = Pick<
  ExecOptions,
  'allowFailure' | 'timeoutMs' | 'binaryStdout' | 'stdin' | 'signal'
>;

export type AndroidAdbExecutorResult = Pick<
  ExecResult,
  'exitCode' | 'stdout' | 'stderr' | 'stdoutBuffer'
>;

/**
 * Runs device-scoped adb arguments after the device serial has already been selected.
 * Implementations must be safe to call concurrently for one request.
 */
export type AndroidAdbExecutor = (
  args: string[],
  options?: AndroidAdbExecutorOptions,
) => Promise<AndroidAdbExecutorResult>;

export type AndroidAdbSpawner = (args: string[], options?: SpawnOptions) => ChildProcess;

export type AndroidAdbProvider = {
  exec: AndroidAdbExecutor;
  spawn?: AndroidAdbSpawner;
};

const androidAdbProviderScope = new AsyncLocalStorage<AndroidAdbProvider>();

export function createDeviceAdbExecutor(device: DeviceInfo): AndroidAdbExecutor {
  return createSerialAdbExecutor(device.id);
}

function createSerialAdbExecutor(serial: string): AndroidAdbExecutor {
  return async (args, options) =>
    // Local adb execution must escape any active provider scope to avoid routing
    // tunnel-backed providers back into themselves when they shell out to adb.
    await withoutCommandExecutorOverride(
      async () => await runCmd('adb', ['-s', serial, ...args], options),
    );
}

function createSerialAdbSpawner(serial: string): AndroidAdbSpawner {
  return (args, options) => spawn('adb', ['-s', serial, ...args], options ?? {});
}

export function resolveAndroidAdbExecutor(
  device: DeviceInfo,
  executor?: AndroidAdbExecutor,
): AndroidAdbExecutor {
  return executor ?? androidAdbProviderScope.getStore()?.exec ?? createDeviceAdbExecutor(device);
}

export function spawnAndroidAdbBySerial(
  serial: string,
  args: string[],
  options?: SpawnOptions,
): ChildProcess {
  return resolveAndroidSerialAdbSpawner(serial)(args, options);
}

export async function withAndroidAdbProvider<T>(
  provider: AndroidAdbProvider | AndroidAdbExecutor | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return await fn();
  const normalized = typeof provider === 'function' ? { exec: provider } : provider;
  const override = createAndroidCommandExecutorOverride(normalized);
  return await androidAdbProviderScope.run(
    normalized,
    async () => await withCommandExecutorOverride(override, fn),
  );
}

function createAndroidCommandExecutorOverride(
  provider: AndroidAdbProvider,
): CommandExecutorOverride {
  return (cmd, args, options) => {
    if (cmd !== 'adb') return undefined;
    const providerArgs = stripAdbSerialArgs(args);
    if (!providerArgs) return undefined;
    return withoutCommandExecutorOverride(async () => await provider.exec(providerArgs, options));
  };
}

function stripAdbSerialArgs(args: string[]): string[] | undefined {
  // The provider scope only owns normalized device-scoped adb calls produced by
  // this repo's adbArgs helpers: adb -s <serial> <command...>. Global commands
  // such as adb devices/version and host-preconfigured invocations stay local.
  if (args[0] !== '-s' || !args[1]) return undefined;
  return args.slice(2);
}

function resolveAndroidSerialAdbSpawner(serial: string): AndroidAdbSpawner {
  return androidAdbProviderScope.getStore()?.spawn ?? createSerialAdbSpawner(serial);
}
