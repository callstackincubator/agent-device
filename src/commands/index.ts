import type { AgentDeviceRuntime } from '../runtime-contract.ts';
import {
  bindCaptureCommands,
  captureCommands,
  type BoundCaptureCommands,
  type CaptureCommands,
} from './capture/runtime/index.ts';
import {
  bindInteractionCommands,
  bindSelectorCommands,
  interactionCommands,
  selectorCommands,
  type BoundInteractionCommands,
  type BoundSelectorCommands,
  type InteractionCommands,
  type SelectorCommands,
} from './interaction/runtime/index.ts';
import {
  adminCommands,
  appCommands,
  bindAdminCommands,
  bindAppCommands,
  type AdminCommands,
  type AppCommands,
  type BoundAdminCommands,
  type BoundAppCommands,
} from './management/runtime/index.ts';
import {
  bindObservabilityCommands,
  diagnosticsCommands,
  type BoundObservabilityCommands,
  type DiagnosticsCommands,
} from './observability/runtime/index.ts';
import {
  bindRecordingCommands,
  recordingCommands,
  type BoundRecordingCommands,
  type RecordingCommands,
} from './recording/runtime/index.ts';
import {
  bindSystemCommands,
  systemCommands,
  type BoundSystemCommands,
  type SystemCommands,
} from './system/runtime/index.ts';

export type { ScreenshotCommandResult } from './capture/runtime/screenshot.ts';
export type {
  DiffScreenshotCommandOptions,
  DiffScreenshotCommandResult,
  LiveScreenshotInputRef,
} from './capture/runtime/diff-screenshot.ts';
export type {
  DiffSnapshotCommandResult,
  SnapshotCommandResult,
  SnapshotDiffLine,
  SnapshotDiffSummary,
} from './capture/runtime/snapshot.ts';
export type {
  ElementTarget,
  FindReadCommandOptions,
  FindReadCommandResult,
  GetAttrsCommandOptions,
  GetCommandOptions,
  GetCommandResult,
  GetTextCommandOptions,
  IsCommandOptions,
  IsCommandResult,
  IsSelectorCommandOptions,
  RefTarget,
  ResolvedTarget,
  SelectorSnapshotOptions,
  SelectorTarget,
  WaitCommandOptions,
  WaitCommandResult,
  WaitForTextCommandOptions,
} from './interaction/runtime/selector-read.ts';
export type {
  ClickCommandOptions,
  FillCommandOptions,
  FillCommandResult,
  FocusCommandOptions,
  FocusCommandResult,
  InteractionTarget,
  LongPressCommandOptions,
  LongPressCommandResult,
  PinchCommandOptions,
  PinchCommandResult,
  PointTarget,
  PressCommandOptions,
  PressCommandResult,
  ResolvedInteractionTarget,
  ScrollCommandOptions,
  ScrollCommandResult,
  ScrollTarget,
  SwipeCommandOptions,
  SwipeCommandResult,
  SwipeOptions,
  TypeTextCommandOptions,
  TypeTextCommandResult,
} from './interaction/runtime/interactions.ts';
export type {
  AppPushInput,
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
} from './management/runtime/apps.ts';
export type {
  AdminBootCommandOptions,
  AdminBootCommandResult,
  AdminDevicesCommandOptions,
  AdminDevicesCommandResult,
  AdminInstallCommandOptions,
  AdminInstallCommandResult,
  AdminInstallFromSourceCommandOptions,
  AdminReinstallCommandOptions,
  AdminShutdownCommandOptions,
  AdminShutdownCommandResult,
} from './management/runtime/admin.ts';
export type {
  DiagnosticsLogsCommandOptions,
  DiagnosticsLogsCommandResult,
  DiagnosticsNetworkCommandOptions,
  DiagnosticsNetworkCommandResult,
  DiagnosticsPerfCommandOptions,
  DiagnosticsPerfCommandResult,
} from './observability/runtime/diagnostics.ts';
export type {
  RecordingRecordCommandOptions,
  RecordingRecordCommandResult,
  RecordingTraceCommandOptions,
  RecordingTraceCommandResult,
} from './recording/runtime/recording.ts';
export type {
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
} from './system/runtime/system.ts';
export { ref, selector } from './interaction/runtime/selector-read.ts';

export type {
  BoundRuntimeCommand,
  CommandResult,
  DiffSnapshotCommandOptions,
  RuntimeCommand,
  ScreenshotCommandOptions,
  SnapshotCommandOptions,
} from './runtime-types.ts';

export type AgentDeviceCommands = {
  capture: CaptureCommands;
  selectors: SelectorCommands;
  interactions: InteractionCommands;
  system: SystemCommands;
  apps: AppCommands;
  admin: AdminCommands;
  recording: RecordingCommands;
  diagnostics: DiagnosticsCommands;
};

export type BoundAgentDeviceCommands = {
  capture: BoundCaptureCommands;
  selectors: BoundSelectorCommands;
  interactions: BoundInteractionCommands;
  system: BoundSystemCommands;
  apps: BoundAppCommands;
  admin: BoundAdminCommands;
  recording: BoundRecordingCommands;
  observability: BoundObservabilityCommands;
};

export const commands: AgentDeviceCommands = {
  capture: captureCommands,
  selectors: selectorCommands,
  interactions: interactionCommands,
  system: systemCommands,
  apps: appCommands,
  admin: adminCommands,
  recording: recordingCommands,
  diagnostics: diagnosticsCommands,
};

export function bindCommands(runtime: AgentDeviceRuntime): BoundAgentDeviceCommands {
  return {
    capture: bindCaptureCommands(runtime),
    selectors: bindSelectorCommands(runtime),
    interactions: bindInteractionCommands(runtime),
    system: bindSystemCommands(runtime),
    apps: bindAppCommands(runtime),
    admin: bindAdminCommands(runtime),
    recording: bindRecordingCommands(runtime),
    observability: bindObservabilityCommands(runtime),
  };
}
