import { runCmd, whichCmd, type ExecOptions, type ExecResult } from '../../utils/exec.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { createScopedProvider } from '../../utils/scoped-provider.ts';
import { sleep } from '../../utils/timeouts.ts';
import type {
  LinuxAccessibilityTree,
  LinuxSnapshotSurface,
  LinuxTraversalOptions,
} from './accessibility-types.ts';

export type LinuxToolCommandExecutor = (
  cmd: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export type LinuxToolAvailabilityChecker = (cmd: string) => Promise<boolean>;

export type LinuxDesktopProvider = {
  openTarget(target: string): Promise<void>;
  closeApp(app: string): Promise<void>;
};

export type LinuxClipboardProvider = {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
};

export type LinuxScreenshotProvider = {
  capture(outPath: string): Promise<void>;
};

export type LinuxAccessibilityProvider = {
  captureTree(
    surface: LinuxSnapshotSurface,
    options?: LinuxTraversalOptions,
  ): Promise<LinuxAccessibilityTree>;
};

export type LinuxToolProvider = {
  runCommand: LinuxToolCommandExecutor;
  whichCommand: LinuxToolAvailabilityChecker;
  desktop: LinuxDesktopProvider;
  clipboard?: LinuxClipboardProvider;
  screenshot?: LinuxScreenshotProvider;
  accessibility?: LinuxAccessibilityProvider;
};

const localLinuxToolProvider: LinuxToolProvider = {
  runCommand: runCmd,
  whichCommand: whichCmd,
  desktop: createLocalLinuxDesktopProvider(runCmd, whichCmd),
};

const linuxToolProviderScope = createScopedProvider(
  localLinuxToolProvider,
  createLocalLinuxToolProvider,
);

export function createLocalLinuxToolProvider(
  provider: Partial<LinuxToolProvider> = {},
): LinuxToolProvider {
  const merged = {
    ...localLinuxToolProvider,
    ...provider,
  };
  return {
    ...merged,
    desktop:
      provider.desktop ?? createLocalLinuxDesktopProvider(merged.runCommand, merged.whichCommand),
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

function createLocalLinuxDesktopProvider(
  runCommand: LinuxToolCommandExecutor,
  whichCommand: LinuxToolAvailabilityChecker,
): LinuxDesktopProvider {
  return {
    async openTarget(target) {
      if (target.includes('://') || target.startsWith('/')) {
        await runCommand('xdg-open', [target]);
        return;
      }

      if (await whichCommand(target)) {
        runCommand(target, [], { allowFailure: true }).catch((err) => {
          emitDiagnostic({
            level: 'warn',
            phase: 'linux_app_launch',
            data: { app: target, error: String(err) },
          });
        });
        await sleep(500);
        return;
      }

      await runCommand('xdg-open', [target], { allowFailure: true });
    },
    async closeApp(app) {
      if (await whichCommand('wmctrl')) {
        await runCommand('wmctrl', ['-c', app], { allowFailure: true });
        return;
      }

      await runCommand('pkill', ['-x', app], { allowFailure: true });
    },
  };
}
