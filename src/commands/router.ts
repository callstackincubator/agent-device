import type { AgentDeviceRuntime } from '../runtime.ts';
import { AppError, normalizeAgentDeviceError } from '../utils/errors.ts';
import { screenshotCommand } from './capture-screenshot.ts';
import { diffScreenshotCommand } from './capture-diff-screenshot.ts';
import { diffSnapshotCommand, snapshotCommand } from './capture-snapshot.ts';
import { findCommand, getCommand, isCommand, waitCommand } from './selector-read.ts';
import {
  clickCommand,
  fillCommand,
  focusCommand,
  longPressCommand,
  pinchCommand,
  pressCommand,
  scrollCommand,
  swipeCommand,
  typeTextCommand,
} from './interactions.ts';
import {
  alertCommand,
  appSwitcherCommand,
  backCommand,
  clipboardCommand,
  homeCommand,
  keyboardCommand,
  rotateCommand,
  settingsCommand,
} from './system.ts';
import {
  closeAppCommand,
  getAppStateCommand,
  listAppsCommand,
  openAppCommand,
  pushAppCommand,
  triggerAppEventCommand,
} from './apps.ts';
import {
  bootCommand,
  devicesCommand,
  ensureSimulatorCommand,
  installCommand,
  installFromSourceCommand,
  reinstallCommand,
} from './admin.ts';
import { recordCommand, traceCommand } from './recording.ts';
import { logsCommand, networkCommand, perfCommand } from './diagnostics.ts';
import { commandCatalog } from './catalog.ts';
import {
  dispatchBatchCommand,
  dispatchReplayCommand,
  dispatchReplayTestCommand,
} from './router-orchestration.ts';
import type {
  CommandRouter,
  CommandRouterConfig,
  CommandRouterRequest,
  CommandRouterResponse,
  CommandRouterResult,
} from './router-types.ts';

export type {
  CommandRouter,
  CommandRouterConfig,
  CommandRouterRequest,
  CommandRouterResponse,
  CommandRouterResult,
} from './router-types.ts';
export type {
  BatchCommandOptions,
  BatchCommandResult,
  BatchCommandStepResult,
  ReplayCommandOptions,
  ReplayCommandResult,
  ReplayTestCase,
  ReplayTestCaseResult,
  ReplayTestCommandOptions,
  ReplayTestCommandResult,
} from './router-orchestration.ts';

export function createCommandRouter<TContext = unknown>(
  config: CommandRouterConfig<TContext>,
): CommandRouter<TContext> {
  const dispatch = async (
    request: CommandRouterRequest<TContext>,
  ): Promise<CommandRouterResponse> => {
    try {
      assertRouterCommandImplemented(request);
      await config.beforeDispatch?.(request);
      if (request.command === 'batch') {
        return {
          ok: true,
          data: await dispatchBatchCommand(request, dispatch),
        };
      }
      if (request.command === 'replay') {
        return {
          ok: true,
          data: await dispatchReplayCommand(request, dispatch),
        };
      }
      if (request.command === 'test') {
        return {
          ok: true,
          data: await dispatchReplayTestCommand(request, dispatch),
        };
      }
      const runtime = await config.createRuntime(request);
      return { ok: true, data: await dispatchRuntimeCommand(runtime, request) };
    } catch (error) {
      return {
        ok: false,
        error: config.formatError?.(error, request) ?? normalizeAgentDeviceError(error),
      };
    }
  };

  return {
    dispatch,
  };
}

const implementedRouterCommands = new Set<string>([
  'capture.screenshot',
  'capture.diffScreenshot',
  'capture.snapshot',
  'capture.diffSnapshot',
  'selectors.find',
  'selectors.get',
  'selectors.is',
  'selectors.wait',
  'interactions.click',
  'interactions.press',
  'interactions.fill',
  'interactions.typeText',
  'interactions.focus',
  'interactions.longPress',
  'interactions.swipe',
  'interactions.scroll',
  'interactions.pinch',
  'system.back',
  'system.home',
  'system.rotate',
  'system.keyboard',
  'system.clipboard',
  'system.settings',
  'system.alert',
  'system.appSwitcher',
  'apps.open',
  'apps.close',
  'apps.list',
  'apps.state',
  'apps.push',
  'apps.triggerEvent',
  'admin.devices',
  'admin.boot',
  'admin.ensureSimulator',
  'admin.install',
  'admin.reinstall',
  'admin.installFromSource',
  'record',
  'trace',
  'diagnostics.logs',
  'diagnostics.network',
  'diagnostics.perf',
  'batch',
  'replay',
  'test',
]);

function assertRouterCommandImplemented(request: { command: string }): void {
  if (implementedRouterCommands.has(request.command)) return;
  const catalogEntry = commandCatalog.find((entry) => entry.command === request.command);
  if (catalogEntry?.status === 'planned') {
    throw new AppError(
      'NOT_IMPLEMENTED',
      `Command ${request.command} is planned but not implemented in the runtime router yet`,
      { command: request.command },
    );
  }
  throw new AppError('UNSUPPORTED_OPERATION', `Unknown runtime command: ${request.command}`, {
    command: request.command,
  });
}

async function dispatchRuntimeCommand<TContext>(
  runtime: AgentDeviceRuntime,
  request: CommandRouterRequest<TContext>,
): Promise<CommandRouterResult> {
  switch (request.command) {
    case 'capture.screenshot':
      return await screenshotCommand(runtime, request.options);
    case 'capture.diffScreenshot':
      return await diffScreenshotCommand(runtime, request.options);
    case 'capture.snapshot':
      return await snapshotCommand(runtime, request.options);
    case 'capture.diffSnapshot':
      return await diffSnapshotCommand(runtime, request.options);
    case 'selectors.find':
      return await findCommand(runtime, request.options);
    case 'selectors.get':
      return await getCommand(runtime, request.options);
    case 'selectors.is':
      return await isCommand(runtime, request.options);
    case 'selectors.wait':
      return await waitCommand(runtime, request.options);
    case 'interactions.click':
      return await clickCommand(runtime, request.options);
    case 'interactions.press':
      return await pressCommand(runtime, request.options);
    case 'interactions.fill':
      return await fillCommand(runtime, request.options);
    case 'interactions.typeText':
      return await typeTextCommand(runtime, request.options);
    case 'interactions.focus':
      return await focusCommand(runtime, request.options);
    case 'interactions.longPress':
      return await longPressCommand(runtime, request.options);
    case 'interactions.swipe':
      return await swipeCommand(runtime, request.options);
    case 'interactions.scroll':
      return await scrollCommand(runtime, request.options);
    case 'interactions.pinch':
      return await pinchCommand(runtime, request.options);
    case 'system.back':
      return await backCommand(runtime, request.options);
    case 'system.home':
      return await homeCommand(runtime, request.options);
    case 'system.rotate':
      return await rotateCommand(runtime, request.options);
    case 'system.keyboard':
      return await keyboardCommand(runtime, request.options);
    case 'system.clipboard':
      return await clipboardCommand(runtime, request.options);
    case 'system.settings':
      return await settingsCommand(runtime, request.options);
    case 'system.alert':
      return await alertCommand(runtime, request.options);
    case 'system.appSwitcher':
      return await appSwitcherCommand(runtime, request.options);
    case 'apps.open':
      return await openAppCommand(runtime, request.options);
    case 'apps.close':
      return await closeAppCommand(runtime, request.options);
    case 'apps.list':
      return await listAppsCommand(runtime, request.options);
    case 'apps.state':
      return await getAppStateCommand(runtime, request.options);
    case 'apps.push':
      return await pushAppCommand(runtime, request.options);
    case 'apps.triggerEvent':
      return await triggerAppEventCommand(runtime, request.options);
    case 'admin.devices':
      return await devicesCommand(runtime, request.options);
    case 'admin.boot':
      return await bootCommand(runtime, request.options);
    case 'admin.ensureSimulator':
      return await ensureSimulatorCommand(runtime, request.options);
    case 'admin.install':
      return await installCommand(runtime, request.options);
    case 'admin.reinstall':
      return await reinstallCommand(runtime, request.options);
    case 'admin.installFromSource':
      return await installFromSourceCommand(runtime, request.options);
    case 'record':
      return await recordCommand(runtime, request.options);
    case 'trace':
      return await traceCommand(runtime, request.options);
    case 'diagnostics.logs':
      return await logsCommand(runtime, request.options);
    case 'diagnostics.network':
      return await networkCommand(runtime, request.options);
    case 'diagnostics.perf':
      return await perfCommand(runtime, request.options);
  }
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    `Router command ${request.command} is not a runtime command`,
  );
}
