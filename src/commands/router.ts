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
  pressCommand,
  typeTextCommand,
  type ClickCommandOptions,
  type FillCommandOptions,
  type FillCommandResult,
  type PressCommandOptions,
  type PressCommandResult,
  type TypeTextCommandOptions,
  type TypeTextCommandResult,
} from './interactions.ts';
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
  | TypeTextCommandResult;

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
  }
}
