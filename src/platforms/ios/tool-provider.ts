import { AsyncLocalStorage } from 'node:async_hooks';
import {
  runCmd,
  runCmdSync,
  whichCmd,
  type ExecOptions,
  type ExecResult,
} from '../../utils/exec.ts';

export type AppleToolCommandExecutor = (
  cmd: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export type AppleToolSyncCommandExecutor = (
  cmd: string,
  args: string[],
  options?: ExecOptions,
) => ExecResult;

export type AppleToolAvailabilityChecker = (cmd: string) => Promise<boolean>;

export type AppleToolProvider = {
  runCommand: AppleToolCommandExecutor;
  runCommandSync: AppleToolSyncCommandExecutor;
  whichCommand: AppleToolAvailabilityChecker;
};

const localAppleToolProvider: AppleToolProvider = {
  runCommand: runCmd,
  runCommandSync: runCmdSync,
  whichCommand: whichCmd,
};

const appleToolProviderScope = new AsyncLocalStorage<AppleToolProvider>();

export function createLocalAppleToolProvider(
  provider: Partial<AppleToolProvider> = {},
): AppleToolProvider {
  return {
    ...localAppleToolProvider,
    ...provider,
  };
}

export function resolveAppleToolProvider(
  provider?: AppleToolProvider | AppleToolCommandExecutor,
): AppleToolProvider {
  return provider
    ? normalizeAppleToolProvider(provider)
    : (appleToolProviderScope.getStore() ?? localAppleToolProvider);
}

export async function withAppleToolProvider<T>(
  provider: AppleToolProvider | AppleToolCommandExecutor | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return await fn();
  return await appleToolProviderScope.run(normalizeAppleToolProvider(provider), fn);
}

export function hasScopedAppleToolProvider(): boolean {
  return Boolean(appleToolProviderScope.getStore());
}

export async function runAppleToolCommand(
  cmd: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return await resolveAppleToolProvider().runCommand(cmd, args, options);
}

export function runAppleToolCommandSync(
  cmd: string,
  args: string[],
  options?: ExecOptions,
): ExecResult {
  return resolveAppleToolProvider().runCommandSync(cmd, args, options);
}

export async function runXcrun(args: string[], options?: ExecOptions): Promise<ExecResult> {
  return await runAppleToolCommand('xcrun', args, options);
}

function normalizeAppleToolProvider(
  provider: AppleToolProvider | AppleToolCommandExecutor,
): AppleToolProvider {
  if (typeof provider === 'function') {
    return {
      ...localAppleToolProvider,
      runCommand: provider,
      runCommandSync: () => {
        throw new Error('Apple tool provider does not support synchronous command execution');
      },
    };
  }
  return provider;
}
