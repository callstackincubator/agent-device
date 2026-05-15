import { runCmd, whichCmd, type ExecOptions, type ExecResult } from '../../utils/exec.ts';
import { createScopedProvider } from '../../utils/scoped-provider.ts';

export type LinuxToolCommandExecutor = (
  cmd: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export type LinuxToolAvailabilityChecker = (cmd: string) => Promise<boolean>;

export type LinuxToolProvider = {
  runCommand: LinuxToolCommandExecutor;
  whichCommand: LinuxToolAvailabilityChecker;
};

const localLinuxToolProvider: LinuxToolProvider = {
  runCommand: runCmd,
  whichCommand: whichCmd,
};

const linuxToolProviderScope = createScopedProvider(localLinuxToolProvider);

export function createLocalLinuxToolProvider(
  provider: Partial<LinuxToolProvider> = {},
): LinuxToolProvider {
  return {
    ...localLinuxToolProvider,
    ...provider,
  };
}

export function resolveLinuxToolProvider(provider?: LinuxToolProvider): LinuxToolProvider {
  return linuxToolProviderScope.resolve(provider);
}

export async function withLinuxToolProvider<T>(
  provider: LinuxToolProvider | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return await linuxToolProviderScope.run(provider, fn);
}

export async function runLinuxToolCommand(
  cmd: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return await resolveLinuxToolProvider().runCommand(cmd, args, options);
}
