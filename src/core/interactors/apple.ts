import {
  closeIosApp,
  openIosApp,
  openIosDevice,
  readIosClipboardText,
  screenshotIos,
  setIosSetting,
  writeIosClipboardText,
} from '../../platforms/ios/apps.ts';
import {
  appleRemotePressCommand,
  iosRunnerOverrides,
  resolveAppleBackRunnerCommand,
} from '../../platforms/ios/interactions.ts';
import { runMacOsScreenshotAction } from '../../platforms/ios/macos-helper.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import type { RawSnapshotNode } from '../../utils/snapshot.ts';
import type { Interactor, RunnerContext, SnapshotResult } from '../interactor-types.ts';

export function createAppleInteractor(
  device: DeviceInfo,
  runnerContext: RunnerContext,
): Interactor {
  const { overrides, runnerOpts } = iosRunnerOverrides(device, runnerContext);
  return {
    open: (app, options) =>
      openIosApp(device, app, { appBundleId: options?.appBundleId, url: options?.url }),
    openDevice: () => openIosDevice(device),
    close: (app) => closeIosApp(device, app),
    screenshot: async (outPath, options) => {
      if (device.platform === 'macos' && options?.surface && options.surface !== 'app') {
        await runMacOsScreenshotAction(outPath, {
          surface: options.surface,
          fullscreen: options.fullscreen,
        });
        return;
      }
      await screenshotIos(device, outPath, options?.appBundleId, options?.fullscreen, runnerOpts);
    },
    snapshot: async (options) => {
      const result = readAppleSnapshotResult(
        await withDiagnosticTimer(
          'snapshot_capture',
          async () =>
            await runIosRunnerCommand(
              device,
              {
                command: 'snapshot',
                appBundleId: options?.appBundleId,
                interactiveOnly: options?.interactiveOnly,
                compact: options?.compact,
                depth: options?.depth,
                scope: options?.scope,
                raw: options?.raw,
              },
              runnerOpts,
            ),
          { backend: 'xctest' },
        ),
      );
      const nodes = result.nodes ?? [];
      if (nodes.length === 0 && device.kind === 'simulator') {
        throw new AppError('COMMAND_FAILED', 'XCTest snapshot returned 0 nodes on iOS simulator.');
      }
      return { nodes, truncated: result.truncated ?? false, backend: 'xctest' };
    },
    back: async (mode) => {
      if (device.target === 'tv') {
        await runIosRunnerCommand(
          device,
          appleRemotePressCommand('menu', runnerContext.appBundleId),
          runnerOpts,
        );
        return;
      }
      await runIosRunnerCommand(
        device,
        {
          command: resolveAppleBackRunnerCommand(mode),
          appBundleId: runnerContext.appBundleId,
        },
        runnerOpts,
      );
    },
    home: async () => {
      if (device.target === 'tv') {
        await runIosRunnerCommand(
          device,
          appleRemotePressCommand('home', runnerContext.appBundleId),
          runnerOpts,
        );
        return;
      }
      await runIosRunnerCommand(
        device,
        { command: 'home', appBundleId: runnerContext.appBundleId },
        runnerOpts,
      );
    },
    rotate: async (orientation) => {
      await runIosRunnerCommand(
        device,
        { command: 'rotate', orientation, appBundleId: runnerContext.appBundleId },
        runnerOpts,
      );
    },
    appSwitcher: async () => {
      await runIosRunnerCommand(
        device,
        { command: 'appSwitcher', appBundleId: runnerContext.appBundleId },
        runnerOpts,
      );
    },
    readClipboard: () => readIosClipboardText(device),
    writeClipboard: (text) => writeIosClipboardText(device, text),
    setSetting: (setting, state, appId, options) =>
      setIosSetting(device, setting, state, appId, options),
    ...overrides,
  };
}

function readAppleSnapshotResult(
  result: Record<string, unknown>,
): Pick<SnapshotResult, 'nodes' | 'truncated'> {
  return {
    nodes: Array.isArray(result.nodes) ? (result.nodes as RawSnapshotNode[]) : undefined,
    truncated: typeof result.truncated === 'boolean' ? result.truncated : undefined,
  };
}
