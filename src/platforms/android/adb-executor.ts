import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, type SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { DeviceInfo } from '../../utils/device.ts';
import {
  runCmd,
  withCommandExecutorOverride,
  withoutCommandExecutorOverride,
  type CommandExecutorOverride,
  type ExecOptions,
  type ExecResult,
} from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';

export type AndroidAdbExecutorOptions = Pick<
  ExecOptions,
  'allowFailure' | 'timeoutMs' | 'binaryStdout' | 'stdin' | 'signal'
>;

export type AndroidAdbExecutorResult = Pick<
  ExecResult,
  'exitCode' | 'stdout' | 'stderr' | 'stdoutBuffer'
>;

export type AndroidAdbProcess = {
  pid?: number;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(
    event: 'exit' | 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'exit' | 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
};

/**
 * Runs device-scoped adb arguments after the device serial has already been selected.
 * Implementations must be safe to call concurrently for one request.
 */
export type AndroidAdbExecutor = (
  args: string[],
  options?: AndroidAdbExecutorOptions,
) => Promise<AndroidAdbExecutorResult>;

export type AndroidAdbSpawner = (args: string[], options?: SpawnOptions) => AndroidAdbProcess;

export type AndroidPortReverseEndpoint = `tcp:${number}` | `localabstract:${string}`;

export type AndroidPortReverseMapping = {
  local: AndroidPortReverseEndpoint;
  remote: AndroidPortReverseEndpoint;
  ownerId?: string;
};

export type AndroidPortReverseOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type AndroidPortReverseProvider = {
  ensure(mapping: AndroidPortReverseMapping, options?: AndroidPortReverseOptions): Promise<void>;
  remove(local: AndroidPortReverseEndpoint, options?: AndroidPortReverseOptions): Promise<void>;
  removeAllOwned(ownerId: string, options?: AndroidPortReverseOptions): Promise<void>;
  list?(options?: AndroidPortReverseOptions): Promise<AndroidPortReverseMapping[]>;
};

export type AndroidAdbProvider = {
  exec: AndroidAdbExecutor;
  spawn?: AndroidAdbSpawner;
  reverse?: AndroidPortReverseProvider;
};

export type AndroidAdbProviderScopeOptions = {
  serial: string;
};

type AndroidAdbProviderScope = {
  provider: AndroidAdbProvider;
  serial: string;
};

const androidAdbProviderScope = new AsyncLocalStorage<AndroidAdbProviderScope>();

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

export function createLocalAndroidAdbProvider(device: DeviceInfo): AndroidAdbProvider {
  const exec = createDeviceAdbExecutor(device);
  return {
    exec,
    spawn: createSerialAdbSpawner(device.id),
    reverse: createExecAndroidPortReverseProvider(exec),
  };
}

export function resolveAndroidAdbExecutor(
  device: DeviceInfo,
  executor?: AndroidAdbExecutor,
): AndroidAdbExecutor {
  const scoped = androidAdbProviderScope.getStore();
  if (executor) return executor;
  if (scoped?.serial === device.id) return scoped.provider.exec;
  return createDeviceAdbExecutor(device);
}

export function resolveAndroidAdbProvider(
  device: DeviceInfo,
  provider?: AndroidAdbProvider | AndroidAdbExecutor,
): AndroidAdbProvider {
  if (provider) return normalizeAndroidAdbProvider(provider);
  const scoped = androidAdbProviderScope.getStore();
  return scoped?.serial === device.id
    ? normalizeAndroidAdbProvider(scoped.provider)
    : createLocalAndroidAdbProvider(device);
}

export function createAndroidPortReverseManager(
  provider: AndroidAdbProvider | AndroidAdbExecutor,
): AndroidPortReverseProvider {
  const normalized = normalizeAndroidAdbProvider(provider);
  const reverse = normalized.reverse ?? createExecAndroidPortReverseProvider(normalized.exec);
  const active = new Map<AndroidPortReverseEndpoint, AndroidPortReverseMapping>();
  return {
    async ensure(mapping, options) {
      const current = active.get(mapping.local);
      if (current && current.ownerId !== mapping.ownerId) {
        throw new AppError(
          'COMMAND_FAILED',
          `Android port reverse ${mapping.local} is already owned by ${current.ownerId ?? 'another session'}`,
          { current, requested: mapping },
        );
      }
      if (current?.remote === mapping.remote) {
        return;
      }
      await reverse.ensure(mapping, options);
      active.set(mapping.local, { ...mapping });
    },
    async remove(local, options) {
      if (!active.has(local)) {
        await reverse.remove(local, options);
        return;
      }
      await reverse.remove(local, options);
      active.delete(local);
    },
    async removeAllOwned(ownerId, options) {
      const locals = [...active.values()]
        .filter((mapping) => mapping.ownerId === ownerId)
        .map((mapping) => mapping.local);
      if (locals.length === 0) {
        await reverse.removeAllOwned(ownerId, options);
        return;
      }
      for (const local of locals) {
        await reverse.remove(local, options);
        active.delete(local);
      }
    },
    async list(options) {
      return reverse.list ? await reverse.list(options) : [...active.values()];
    },
  };
}

function normalizeAndroidAdbProvider(
  provider: AndroidAdbProvider | AndroidAdbExecutor,
): AndroidAdbProvider {
  if (typeof provider === 'function') {
    return { exec: provider };
  }
  return provider;
}

export async function withAndroidAdbProvider<T>(
  provider: AndroidAdbProvider | AndroidAdbExecutor | undefined,
  options: AndroidAdbProviderScopeOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return await fn();
  const normalized = typeof provider === 'function' ? { exec: provider } : provider;
  const scope = { provider: normalized, serial: options.serial };
  const override = createAndroidCommandExecutorOverride(scope);
  return await androidAdbProviderScope.run(
    scope,
    async () => await withCommandExecutorOverride(override, fn),
  );
}

function createAndroidCommandExecutorOverride(
  scope: AndroidAdbProviderScope,
): CommandExecutorOverride {
  return (cmd, args, options) => {
    if (cmd !== 'adb') return undefined;
    const providerArgs = stripAdbSerialArgs(args, scope.serial);
    if (!providerArgs) return undefined;
    return withoutCommandExecutorOverride(
      async () => await scope.provider.exec(providerArgs, options),
    );
  };
}

function stripAdbSerialArgs(args: string[], expectedSerial: string): string[] | undefined {
  // The provider scope only owns normalized device-scoped adb calls:
  // adb -s <serial> <command...>. Global commands
  // such as adb devices/version, calls for another serial, and host-preconfigured
  // invocations stay local.
  if (args[0] !== '-s' || !args[1]) return undefined;
  if (args[1] !== expectedSerial) return undefined;
  return args.slice(2);
}

function createExecAndroidPortReverseProvider(adb: AndroidAdbExecutor): AndroidPortReverseProvider {
  const owned = new Map<string, Set<AndroidPortReverseEndpoint>>();
  return {
    async ensure(mapping, options) {
      await adb(['reverse', mapping.local, mapping.remote], {
        allowFailure: false,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
      if (mapping.ownerId) {
        const ownedLocals = owned.get(mapping.ownerId) ?? new Set<AndroidPortReverseEndpoint>();
        ownedLocals.add(mapping.local);
        owned.set(mapping.ownerId, ownedLocals);
      }
    },
    async remove(local, options) {
      const result = await adb(['reverse', '--remove', local], {
        allowFailure: true,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
      if (result.exitCode !== 0 && !isMissingReverseMapping(result.stdout, result.stderr)) {
        throw new Error(`Failed to remove Android port reverse ${local}: ${result.stderr}`);
      }
      for (const locals of owned.values()) {
        locals.delete(local);
      }
    },
    async removeAllOwned(ownerId, options) {
      const locals = [...(owned.get(ownerId) ?? [])];
      for (const local of locals) {
        await this.remove(local, options);
      }
      owned.delete(ownerId);
    },
    async list(options) {
      const result = await adb(['reverse', '--list'], {
        allowFailure: true,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
      if (result.exitCode !== 0) return [];
      return parseAndroidReverseList(result.stdout, owned);
    },
  };
}

function parseAndroidReverseList(
  stdout: string,
  owned: ReadonlyMap<string, ReadonlySet<AndroidPortReverseEndpoint>>,
): AndroidPortReverseMapping[] {
  const ownerByLocal = new Map<AndroidPortReverseEndpoint, string>();
  for (const [ownerId, locals] of owned) {
    for (const local of locals) {
      ownerByLocal.set(local, ownerId);
    }
  }
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts): parts is [string, string, string] => parts.length >= 3)
    .map(([, local, remote]) => {
      const localEndpoint = local as AndroidPortReverseEndpoint;
      return {
        local: localEndpoint,
        remote: remote as AndroidPortReverseEndpoint,
        ownerId: ownerByLocal.get(localEndpoint),
      };
    });
}

function isMissingReverseMapping(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return text.includes('listener') && text.includes('not found');
}
