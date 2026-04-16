import type { AgentDeviceRuntime } from '../runtime.ts';
import { AppError, normalizeAgentDeviceError, type NormalizedError } from '../utils/errors.ts';
import { screenshotCommand, type ScreenshotCommandResult } from './capture-screenshot.ts';
import {
  diffScreenshotCommand,
  type DiffScreenshotCommandOptions,
  type DiffScreenshotCommandResult,
} from './capture-diff-screenshot.ts';
import {
  diffSnapshotCommand,
  snapshotCommand,
  type DiffSnapshotCommandResult,
  type SnapshotCommandResult,
} from './capture-snapshot.ts';
import {
  findCommand,
  getCommand,
  isCommand,
  waitCommand,
  type FindReadCommandOptions,
  type FindReadCommandResult,
  type GetCommandOptions,
  type GetCommandResult,
  type IsCommandOptions,
  type IsCommandResult,
  type WaitCommandOptions,
  type WaitCommandResult,
} from './selector-read.ts';
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
  type ClickCommandOptions,
  type FillCommandOptions,
  type FillCommandResult,
  type FocusCommandOptions,
  type FocusCommandResult,
  type LongPressCommandOptions,
  type LongPressCommandResult,
  type PinchCommandOptions,
  type PinchCommandResult,
  type PressCommandOptions,
  type PressCommandResult,
  type ScrollCommandOptions,
  type ScrollCommandResult,
  type SwipeCommandOptions,
  type SwipeCommandResult,
  type TypeTextCommandOptions,
  type TypeTextCommandResult,
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
  type SystemAlertCommandOptions,
  type SystemAlertCommandResult,
  type SystemAppSwitcherCommandOptions,
  type SystemAppSwitcherCommandResult,
  type SystemBackCommandOptions,
  type SystemBackCommandResult,
  type SystemClipboardCommandOptions,
  type SystemClipboardCommandResult,
  type SystemHomeCommandOptions,
  type SystemHomeCommandResult,
  type SystemKeyboardCommandOptions,
  type SystemKeyboardCommandResult,
  type SystemRotateCommandOptions,
  type SystemRotateCommandResult,
  type SystemSettingsCommandOptions,
  type SystemSettingsCommandResult,
} from './system.ts';
import {
  closeAppCommand,
  getAppStateCommand,
  listAppsCommand,
  openAppCommand,
  pushAppCommand,
  triggerAppEventCommand,
  type CloseAppCommandOptions,
  type CloseAppCommandResult,
  type GetAppStateCommandOptions,
  type GetAppStateCommandResult,
  type ListAppsCommandOptions,
  type ListAppsCommandResult,
  type OpenAppCommandOptions,
  type OpenAppCommandResult,
  type PushAppCommandOptions,
  type PushAppCommandResult,
  type TriggerAppEventCommandOptions,
  type TriggerAppEventCommandResult,
} from './apps.ts';
import type {
  DiffSnapshotCommandOptions,
  ScreenshotCommandOptions,
  SnapshotCommandOptions,
} from './index.ts';
import { commandCatalog } from './catalog.ts';

export type CommandRouterRequest<TContext = unknown> =
  | {
      command: 'capture.screenshot';
      options: ScreenshotCommandOptions;
      context?: TContext;
    }
  | {
      command: 'capture.diffScreenshot';
      options: DiffScreenshotCommandOptions;
      context?: TContext;
    }
  | {
      command: 'capture.snapshot';
      options: SnapshotCommandOptions;
      context?: TContext;
    }
  | {
      command: 'capture.diffSnapshot';
      options: DiffSnapshotCommandOptions;
      context?: TContext;
    }
  | {
      command: 'selectors.find';
      options: FindReadCommandOptions;
      context?: TContext;
    }
  | {
      command: 'selectors.get';
      options: GetCommandOptions;
      context?: TContext;
    }
  | {
      command: 'selectors.is';
      options: IsCommandOptions;
      context?: TContext;
    }
  | {
      command: 'selectors.wait';
      options: WaitCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.click';
      options: ClickCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.press';
      options: PressCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.fill';
      options: FillCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.typeText';
      options: TypeTextCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.focus';
      options: FocusCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.longPress';
      options: LongPressCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.swipe';
      options: SwipeCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.scroll';
      options: ScrollCommandOptions;
      context?: TContext;
    }
  | {
      command: 'interactions.pinch';
      options: PinchCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.back';
      options?: SystemBackCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.home';
      options?: SystemHomeCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.rotate';
      options: SystemRotateCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.keyboard';
      options?: SystemKeyboardCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.clipboard';
      options: SystemClipboardCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.settings';
      options?: SystemSettingsCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.alert';
      options?: SystemAlertCommandOptions;
      context?: TContext;
    }
  | {
      command: 'system.appSwitcher';
      options?: SystemAppSwitcherCommandOptions;
      context?: TContext;
    }
  | {
      command: 'apps.open';
      options: OpenAppCommandOptions;
      context?: TContext;
    }
  | {
      command: 'apps.close';
      options?: CloseAppCommandOptions;
      context?: TContext;
    }
  | {
      command: 'apps.list';
      options?: ListAppsCommandOptions;
      context?: TContext;
    }
  | {
      command: 'apps.state';
      options: GetAppStateCommandOptions;
      context?: TContext;
    }
  | {
      command: 'apps.push';
      options: PushAppCommandOptions;
      context?: TContext;
    }
  | {
      command: 'apps.triggerEvent';
      options: TriggerAppEventCommandOptions;
      context?: TContext;
    };

export type CommandRouterResult =
  | ScreenshotCommandResult
  | DiffScreenshotCommandResult
  | SnapshotCommandResult
  | DiffSnapshotCommandResult
  | FindReadCommandResult
  | GetCommandResult
  | IsCommandResult
  | WaitCommandResult
  | PressCommandResult
  | FillCommandResult
  | TypeTextCommandResult
  | FocusCommandResult
  | LongPressCommandResult
  | SwipeCommandResult
  | ScrollCommandResult
  | PinchCommandResult
  | SystemBackCommandResult
  | SystemHomeCommandResult
  | SystemRotateCommandResult
  | SystemKeyboardCommandResult
  | SystemClipboardCommandResult
  | SystemSettingsCommandResult
  | SystemAlertCommandResult
  | SystemAppSwitcherCommandResult
  | OpenAppCommandResult
  | CloseAppCommandResult
  | ListAppsCommandResult
  | GetAppStateCommandResult
  | PushAppCommandResult
  | TriggerAppEventCommandResult;

export type CommandRouterResponse =
  | {
      ok: true;
      data: CommandRouterResult;
    }
  | {
      ok: false;
      error: NormalizedError;
    };

export type CommandRouter<TContext = unknown> = {
  dispatch(request: CommandRouterRequest<TContext>): Promise<CommandRouterResponse>;
};

export type CommandRouterConfig<TContext = unknown> = {
  createRuntime(
    request: CommandRouterRequest<TContext>,
  ): AgentDeviceRuntime | Promise<AgentDeviceRuntime>;
  beforeDispatch?(request: CommandRouterRequest<TContext>): void | Promise<void>;
  formatError?(error: unknown, request: CommandRouterRequest<TContext>): NormalizedError;
};

export function createCommandRouter<TContext = unknown>(
  config: CommandRouterConfig<TContext>,
): CommandRouter<TContext> {
  return {
    dispatch: async (request) => {
      try {
        assertRouterCommandImplemented(request);
        await config.beforeDispatch?.(request);
        const runtime = await config.createRuntime(request);
        return { ok: true, data: await dispatchRuntimeCommand(runtime, request) };
      } catch (error) {
        return {
          ok: false,
          error: config.formatError?.(error, request) ?? normalizeAgentDeviceError(error),
        };
      }
    },
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
  }
}
