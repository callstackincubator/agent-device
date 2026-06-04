import { withRetry } from '../../utils/retry.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import {
  type RunnerSessionOptions,
  ensureRunnerSession,
  validateRunnerDevice,
} from './runner-session.ts';
import {
  assertRunnerRequestActive,
  isReadOnlyRunnerCommand,
  isRetryableRunnerError,
  withRunnerCommandId,
  type RunnerCommand,
} from './runner-contract.ts';
import {
  createLocalAppleRunnerProvider,
  hasScopedAppleRunnerProvider,
  resolveAppleRunnerProvider,
  type AppleRunnerCommandOptions,
} from './runner-provider.ts';
import {
  executeRunnerCommand,
  prepareLocalIosRunner,
  type PrepareIosRunnerOptions,
  type PrepareIosRunnerResult,
} from './runner-lifecycle.ts';
export {
  isRetryableRunnerError,
  resolveRunnerEarlyExitHint,
  resolveRunnerBuildFailureHint,
  shouldRetryRunnerConnectError,
  type RunnerCommand,
} from './runner-contract.ts';
export type { PrepareIosRunnerOptions, PrepareIosRunnerResult } from './runner-lifecycle.ts';

// --- Runner command execution ---

export async function runIosRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: AppleRunnerCommandOptions = {},
): Promise<Record<string, unknown>> {
  validateRunnerDevice(device);
  assertRunnerRequestActive(options.requestId);
  const runnerCommand = withRunnerCommandId(command);
  const provider = resolveAppleRunnerProvider(
    device,
    createLocalAppleRunnerProvider(executeRunnerCommand),
    undefined,
    { requestId: options.requestId },
  );
  if (isReadOnlyRunnerCommand(runnerCommand.command)) {
    return withRetry(
      () => {
        assertRunnerRequestActive(options.requestId);
        return provider.runCommand(device, runnerCommand, options);
      },
      {
        shouldRetry: (error) => {
          assertRunnerRequestActive(options.requestId);
          return isRetryableRunnerError(error);
        },
      },
    );
  }
  return provider.runCommand(device, runnerCommand, options);
}

export function prewarmIosRunnerSession(
  device: DeviceInfo,
  options: RunnerSessionOptions = {},
): Promise<void> | undefined {
  if (device.platform !== 'ios') {
    return undefined;
  }
  if (hasScopedAppleRunnerProvider(device, { requestId: options.requestId })) {
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_runner_session_prewarm_skipped_scoped_provider',
      data: { deviceId: device.id },
    });
    return undefined;
  }
  const prewarm = ensureRunnerSession(device, options)
    .then(() => {})
    .catch((error: unknown) => {
      emitDiagnostic({
        level: 'warn',
        phase: 'ios_runner_session_prewarm_failed',
        data: {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  void prewarm;
  return prewarm;
}

export async function prepareIosRunner(
  device: DeviceInfo,
  options: PrepareIosRunnerOptions,
): Promise<PrepareIosRunnerResult> {
  validateRunnerDevice(device);
  assertRunnerRequestActive(options.requestId);
  const command = withRunnerCommandId({ command: 'uptime' });
  if (hasScopedAppleRunnerProvider(device, { requestId: options.requestId })) {
    const provider = resolveAppleRunnerProvider(
      device,
      createLocalAppleRunnerProvider(executeRunnerCommand),
      undefined,
      { requestId: options.requestId },
    );
    const healthStartedAt = Date.now();
    const runner = await provider.runCommand(device, command, options);
    return {
      runner,
      connectMs: 0,
      healthCheckMs: Math.max(0, Date.now() - healthStartedAt),
    };
  }
  return await prepareLocalIosRunner(device, options);
}

export {
  resolveRunnerDestination,
  resolveRunnerBuildDestination,
  resolveRunnerMaxConcurrentDestinationsFlag,
  resolveRunnerAppBundleId,
  resolveRunnerSigningBuildSettings,
  resolveRunnerBundleBuildSettings,
  assertSafeDerivedCleanup,
  IOS_RUNNER_CONTAINER_BUNDLE_IDS,
} from './runner-xctestrun.ts';

export {
  getRunnerSessionSnapshot,
  stopIosRunnerSession,
  abortAllIosRunnerSessions,
  stopAllIosRunnerSessions,
} from './runner-session.ts';
