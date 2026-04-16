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
import { dispatchBatchCommand } from './router-orchestration.ts';
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
} from './router-orchestration.ts';

type RuntimeRouterRequest<TContext = unknown> = Exclude<
  CommandRouterRequest<TContext>,
  { command: 'batch' }
>;

type RuntimeRouterCommandName = RuntimeRouterRequest['command'];

type RuntimeRouterDispatcher<TCommand extends RuntimeRouterCommandName> = <TContext>(
  runtime: AgentDeviceRuntime,
  request: Extract<RuntimeRouterRequest<TContext>, { command: TCommand }>,
) => Promise<CommandRouterResult>;

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

function createRuntimeDispatcher<TCommand extends RuntimeRouterCommandName, TOptions>(
  command: (runtime: AgentDeviceRuntime, options: TOptions) => Promise<CommandRouterResult>,
): RuntimeRouterDispatcher<TCommand> {
  return async <TContext>(
    runtime: AgentDeviceRuntime,
    request: Extract<RuntimeRouterRequest<TContext>, { command: TCommand }>,
  ): Promise<CommandRouterResult> => await command(runtime, request.options as TOptions);
}

const runtimeRouterDispatchers = {
  'capture.screenshot': createRuntimeDispatcher(screenshotCommand),
  'capture.diffScreenshot': createRuntimeDispatcher(diffScreenshotCommand),
  'capture.snapshot': createRuntimeDispatcher(snapshotCommand),
  'capture.diffSnapshot': createRuntimeDispatcher(diffSnapshotCommand),
  'selectors.find': createRuntimeDispatcher(findCommand),
  'selectors.get': createRuntimeDispatcher(getCommand),
  'selectors.is': createRuntimeDispatcher(isCommand),
  'selectors.wait': createRuntimeDispatcher(waitCommand),
  'interactions.click': createRuntimeDispatcher(clickCommand),
  'interactions.press': createRuntimeDispatcher(pressCommand),
  'interactions.fill': createRuntimeDispatcher(fillCommand),
  'interactions.typeText': createRuntimeDispatcher(typeTextCommand),
  'interactions.focus': createRuntimeDispatcher(focusCommand),
  'interactions.longPress': createRuntimeDispatcher(longPressCommand),
  'interactions.swipe': createRuntimeDispatcher(swipeCommand),
  'interactions.scroll': createRuntimeDispatcher(scrollCommand),
  'interactions.pinch': createRuntimeDispatcher(pinchCommand),
  'system.back': createRuntimeDispatcher(backCommand),
  'system.home': createRuntimeDispatcher(homeCommand),
  'system.rotate': createRuntimeDispatcher(rotateCommand),
  'system.keyboard': createRuntimeDispatcher(keyboardCommand),
  'system.clipboard': createRuntimeDispatcher(clipboardCommand),
  'system.settings': createRuntimeDispatcher(settingsCommand),
  'system.alert': createRuntimeDispatcher(alertCommand),
  'system.appSwitcher': createRuntimeDispatcher(appSwitcherCommand),
  'apps.open': createRuntimeDispatcher(openAppCommand),
  'apps.close': createRuntimeDispatcher(closeAppCommand),
  'apps.list': createRuntimeDispatcher(listAppsCommand),
  'apps.state': createRuntimeDispatcher(getAppStateCommand),
  'apps.push': createRuntimeDispatcher(pushAppCommand),
  'apps.triggerEvent': createRuntimeDispatcher(triggerAppEventCommand),
  'admin.devices': createRuntimeDispatcher(devicesCommand),
  'admin.boot': createRuntimeDispatcher(bootCommand),
  'admin.ensureSimulator': createRuntimeDispatcher(ensureSimulatorCommand),
  'admin.install': createRuntimeDispatcher(installCommand),
  'admin.reinstall': createRuntimeDispatcher(reinstallCommand),
  'admin.installFromSource': createRuntimeDispatcher(installFromSourceCommand),
  record: createRuntimeDispatcher(recordCommand),
  trace: createRuntimeDispatcher(traceCommand),
  'diagnostics.logs': createRuntimeDispatcher(logsCommand),
  'diagnostics.network': createRuntimeDispatcher(networkCommand),
  'diagnostics.perf': createRuntimeDispatcher(perfCommand),
} satisfies {
  [K in RuntimeRouterCommandName]: RuntimeRouterDispatcher<K>;
};

export const runtimeRouterCommandNames = Object.freeze(
  Object.keys(runtimeRouterDispatchers) as RuntimeRouterCommandName[],
);

function isRuntimeRouterCommandName(command: string): command is RuntimeRouterCommandName {
  return Object.hasOwn(runtimeRouterDispatchers, command);
}

function assertRouterCommandImplemented(request: { command: string }): void {
  if (request.command === 'batch' || isRuntimeRouterCommandName(request.command)) return;
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
  request: RuntimeRouterRequest<TContext>,
): Promise<CommandRouterResult> {
  const dispatcher = runtimeRouterDispatchers[request.command];
  if (!dispatcher) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Router command ${request.command} is not a runtime command`,
    );
  }
  return await dispatcher(runtime, request as never);
}
