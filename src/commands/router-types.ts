import type { AgentDeviceRuntime, CommandContext } from '../runtime-contract.ts';
import type { NormalizedError } from '../utils/errors.ts';
import type { ScreenshotCommandResult } from './capture-screenshot.ts';
import type {
  DiffScreenshotCommandOptions,
  DiffScreenshotCommandResult,
} from './capture-diff-screenshot.ts';
import type { DiffSnapshotCommandResult, SnapshotCommandResult } from './capture-snapshot.ts';
import type {
  FindReadCommandOptions,
  FindReadCommandResult,
  GetCommandOptions,
  GetCommandResult,
  IsCommandOptions,
  IsCommandResult,
  WaitCommandOptions,
  WaitCommandResult,
} from './selector-read.ts';
import type {
  ClickCommandOptions,
  FillCommandOptions,
  FillCommandResult,
  FocusCommandOptions,
  FocusCommandResult,
  LongPressCommandOptions,
  LongPressCommandResult,
  PinchCommandOptions,
  PinchCommandResult,
  PressCommandOptions,
  PressCommandResult,
  ScrollCommandOptions,
  ScrollCommandResult,
  SwipeCommandOptions,
  SwipeCommandResult,
  TypeTextCommandOptions,
  TypeTextCommandResult,
} from './interactions.ts';
import type {
  SystemAlertCommandOptions,
  SystemAlertCommandResult,
  SystemAppSwitcherCommandOptions,
  SystemAppSwitcherCommandResult,
  SystemBackCommandOptions,
  SystemBackCommandResult,
  SystemClipboardCommandOptions,
  SystemClipboardCommandResult,
  SystemHomeCommandOptions,
  SystemHomeCommandResult,
  SystemKeyboardCommandOptions,
  SystemKeyboardCommandResult,
  SystemRotateCommandOptions,
  SystemRotateCommandResult,
  SystemSettingsCommandOptions,
  SystemSettingsCommandResult,
} from './system.ts';
import type {
  CloseAppCommandOptions,
  CloseAppCommandResult,
  GetAppStateCommandOptions,
  GetAppStateCommandResult,
  ListAppsCommandOptions,
  ListAppsCommandResult,
  OpenAppCommandOptions,
  OpenAppCommandResult,
  PushAppCommandOptions,
  PushAppCommandResult,
  TriggerAppEventCommandOptions,
  TriggerAppEventCommandResult,
} from './apps.ts';
import type {
  AdminBootCommandOptions,
  AdminBootCommandResult,
  AdminDevicesCommandOptions,
  AdminDevicesCommandResult,
  AdminEnsureSimulatorCommandOptions,
  AdminEnsureSimulatorCommandResult,
  AdminInstallCommandOptions,
  AdminInstallCommandResult,
  AdminInstallFromSourceCommandOptions,
  AdminReinstallCommandOptions,
} from './admin.ts';
import type {
  RecordingRecordCommandOptions,
  RecordingRecordCommandResult,
  RecordingTraceCommandOptions,
  RecordingTraceCommandResult,
} from './recording.ts';
import type {
  DiagnosticsLogsCommandOptions,
  DiagnosticsLogsCommandResult,
  DiagnosticsNetworkCommandOptions,
  DiagnosticsNetworkCommandResult,
  DiagnosticsPerfCommandOptions,
  DiagnosticsPerfCommandResult,
} from './diagnostics.ts';
import type {
  DiffSnapshotCommandOptions,
  ScreenshotCommandOptions,
  SnapshotCommandOptions,
} from './runtime-types.ts';

export type CommandRouterRequest<TContext = unknown> =
  | { command: 'capture.screenshot'; options: ScreenshotCommandOptions; context?: TContext }
  | {
      command: 'capture.diffScreenshot';
      options: DiffScreenshotCommandOptions;
      context?: TContext;
    }
  | { command: 'capture.snapshot'; options: SnapshotCommandOptions; context?: TContext }
  | { command: 'capture.diffSnapshot'; options: DiffSnapshotCommandOptions; context?: TContext }
  | { command: 'selectors.find'; options: FindReadCommandOptions; context?: TContext }
  | { command: 'selectors.get'; options: GetCommandOptions; context?: TContext }
  | { command: 'selectors.is'; options: IsCommandOptions; context?: TContext }
  | { command: 'selectors.wait'; options: WaitCommandOptions; context?: TContext }
  | { command: 'interactions.click'; options: ClickCommandOptions; context?: TContext }
  | { command: 'interactions.press'; options: PressCommandOptions; context?: TContext }
  | { command: 'interactions.fill'; options: FillCommandOptions; context?: TContext }
  | { command: 'interactions.typeText'; options: TypeTextCommandOptions; context?: TContext }
  | { command: 'interactions.focus'; options: FocusCommandOptions; context?: TContext }
  | { command: 'interactions.longPress'; options: LongPressCommandOptions; context?: TContext }
  | { command: 'interactions.swipe'; options: SwipeCommandOptions; context?: TContext }
  | { command: 'interactions.scroll'; options: ScrollCommandOptions; context?: TContext }
  | { command: 'interactions.pinch'; options: PinchCommandOptions; context?: TContext }
  | { command: 'system.back'; options?: SystemBackCommandOptions; context?: TContext }
  | { command: 'system.home'; options?: SystemHomeCommandOptions; context?: TContext }
  | { command: 'system.rotate'; options: SystemRotateCommandOptions; context?: TContext }
  | { command: 'system.keyboard'; options?: SystemKeyboardCommandOptions; context?: TContext }
  | { command: 'system.clipboard'; options: SystemClipboardCommandOptions; context?: TContext }
  | { command: 'system.settings'; options?: SystemSettingsCommandOptions; context?: TContext }
  | { command: 'system.alert'; options?: SystemAlertCommandOptions; context?: TContext }
  | {
      command: 'system.appSwitcher';
      options?: SystemAppSwitcherCommandOptions;
      context?: TContext;
    }
  | { command: 'apps.open'; options: OpenAppCommandOptions; context?: TContext }
  | { command: 'apps.close'; options?: CloseAppCommandOptions; context?: TContext }
  | { command: 'apps.list'; options?: ListAppsCommandOptions; context?: TContext }
  | { command: 'apps.state'; options: GetAppStateCommandOptions; context?: TContext }
  | { command: 'apps.push'; options: PushAppCommandOptions; context?: TContext }
  | {
      command: 'apps.triggerEvent';
      options: TriggerAppEventCommandOptions;
      context?: TContext;
    }
  | { command: 'admin.devices'; options?: AdminDevicesCommandOptions; context?: TContext }
  | { command: 'admin.boot'; options?: AdminBootCommandOptions; context?: TContext }
  | {
      command: 'admin.ensureSimulator';
      options: AdminEnsureSimulatorCommandOptions;
      context?: TContext;
    }
  | { command: 'admin.install'; options: AdminInstallCommandOptions; context?: TContext }
  | { command: 'admin.reinstall'; options: AdminReinstallCommandOptions; context?: TContext }
  | {
      command: 'admin.installFromSource';
      options: AdminInstallFromSourceCommandOptions;
      context?: TContext;
    }
  | { command: 'record'; options: RecordingRecordCommandOptions; context?: TContext }
  | { command: 'trace'; options: RecordingTraceCommandOptions; context?: TContext }
  | { command: 'diagnostics.logs'; options?: DiagnosticsLogsCommandOptions; context?: TContext }
  | {
      command: 'diagnostics.network';
      options?: DiagnosticsNetworkCommandOptions;
      context?: TContext;
    }
  | { command: 'diagnostics.perf'; options?: DiagnosticsPerfCommandOptions; context?: TContext }
  | { command: 'batch'; options: BatchCommandOptions<TContext>; context?: TContext };

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
  | TriggerAppEventCommandResult
  | AdminDevicesCommandResult
  | AdminBootCommandResult
  | AdminEnsureSimulatorCommandResult
  | AdminInstallCommandResult
  | RecordingRecordCommandResult
  | RecordingTraceCommandResult
  | DiagnosticsLogsCommandResult
  | DiagnosticsNetworkCommandResult
  | DiagnosticsPerfCommandResult
  | BatchCommandResult;

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

export type BatchCommandOptions<TContext = unknown> = CommandContext & {
  steps: readonly CommandRouterRequest<TContext>[];
  stopOnError?: boolean;
  maxSteps?: number;
};

export type BatchCommandStepResult =
  | {
      step: number;
      command: string;
      ok: true;
      data: CommandRouterResult;
      durationMs: number;
    }
  | {
      step: number;
      command: string;
      ok: false;
      error: NormalizedError;
      durationMs: number;
    };

export type BatchCommandResult = {
  kind: 'batch';
  total: number;
  executed: number;
  failed: number;
  totalDurationMs: number;
  results: readonly BatchCommandStepResult[];
};
