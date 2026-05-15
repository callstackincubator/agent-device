import {
  runCmd,
  runCmdSync,
  whichCmd,
  type ExecOptions,
  type ExecResult,
} from '../../utils/exec.ts';
import { createScopedProvider } from '../../utils/scoped-provider.ts';

export type AppleToolCommandExecutor = (
  cmd: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export type AppleToolSubcommandExecutor = (
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export type AppleToolAvailabilityChecker = (cmd: string) => Promise<boolean>;

export type AppleXcrunToolProvider = {
  run: AppleToolSubcommandExecutor;
};

export type ApplePlistProvider = {
  readJson(path: string): Promise<Record<string, unknown> | null>;
};

export type AppleToolProvider = {
  runCommand: AppleToolCommandExecutor;
  simctl?: AppleXcrunToolProvider;
  devicectl?: AppleXcrunToolProvider;
  plist?: ApplePlistProvider;
  whichCommand: AppleToolAvailabilityChecker;
};

const localAppleToolProvider: AppleToolProvider = {
  runCommand: runCmd,
  simctl: {
    run: async (args, options) => await runCmd('xcrun', ['simctl', ...args], options),
  },
  devicectl: {
    run: async (args, options) => await runCmd('xcrun', ['devicectl', ...args], options),
  },
  plist: {
    readJson: async (plistPath) => await readPlistJsonWithCommand(runCmd, plistPath),
  },
  whichCommand: whichCmd,
};

type AppleToolProviderInput = AppleToolProvider | AppleToolCommandExecutor;

const appleToolProviderScope = createScopedProvider<AppleToolProvider, AppleToolProviderInput>(
  localAppleToolProvider,
  normalizeAppleToolProvider,
);

export function createLocalAppleToolProvider(
  provider: Partial<AppleToolProvider> = {},
): AppleToolProvider {
  const merged = {
    ...localAppleToolProvider,
    ...provider,
  };
  return {
    ...merged,
    simctl: provider.simctl ?? {
      run: async (args, options) => await merged.runCommand('xcrun', ['simctl', ...args], options),
    },
    devicectl: provider.devicectl ?? {
      run: async (args, options) =>
        await merged.runCommand('xcrun', ['devicectl', ...args], options),
    },
    plist: provider.plist ?? {
      readJson: async (plistPath) => await readPlistJsonWithCommand(merged.runCommand, plistPath),
    },
  };
}

export function resolveAppleToolProvider(provider?: AppleToolProviderInput): AppleToolProvider {
  return appleToolProviderScope.resolve(provider);
}

export async function withAppleToolProvider<T>(
  provider: AppleToolProviderInput | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return await appleToolProviderScope.run(provider, fn);
}

export function hasScopedAppleToolProvider(): boolean {
  return appleToolProviderScope.hasScope();
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
  // Synchronous Apple tool calls are intentionally local-only. Remote/cloud providers
  // cannot implement sync process execution; convert callers before moving them behind
  // the provider seam.
  return runCmdSync(cmd, args, options);
}

export async function runXcrun(args: string[], options?: ExecOptions): Promise<ExecResult> {
  const provider = resolveAppleToolProvider();
  const [tool, ...toolArgs] = args;
  if (tool === 'simctl') {
    return await (provider.simctl?.run(toolArgs, options) ??
      provider.runCommand('xcrun', args, options));
  }
  if (tool === 'devicectl') {
    return await (provider.devicectl?.run(toolArgs, options) ??
      provider.runCommand('xcrun', args, options));
  }
  return await runAppleToolCommand('xcrun', args, options);
}

export async function readApplePlistJson(
  plistPath: string,
): Promise<Record<string, unknown> | null> {
  return (await resolveAppleToolProvider().plist?.readJson(plistPath)) ?? null;
}

function normalizeAppleToolProvider(provider: AppleToolProviderInput): AppleToolProvider {
  if (typeof provider === 'function') {
    return createLocalAppleToolProvider({ runCommand: provider });
  }
  return createLocalAppleToolProvider(provider);
}

async function readPlistJsonWithCommand(
  runCommand: AppleToolCommandExecutor,
  plistPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await runCommand('plutil', ['-convert', 'json', '-o', '-', plistPath], {
      allowFailure: true,
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null;
    }
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}
