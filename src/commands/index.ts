import type { AgentDeviceRuntime } from '../runtime-contract.ts';
import type {
  BoundRuntimeCommand,
  DiffSnapshotCommandOptions,
  RuntimeCommand,
  ScreenshotCommandOptions,
  SnapshotCommandOptions,
} from './runtime-types.ts';
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
  getAttrsCommand,
  getCommand,
  getTextCommand,
  isHiddenCommand,
  isVisibleCommand,
  isCommand,
  waitCommand,
  waitForTextCommand,
  type ElementTarget,
  type FindReadCommandOptions,
  type FindReadCommandResult,
  type GetAttrsCommandOptions,
  type GetCommandOptions,
  type GetCommandResult,
  type GetTextCommandOptions,
  type IsCommandOptions,
  type IsCommandResult,
  type IsSelectorCommandOptions,
  type SelectorTarget,
  type WaitCommandOptions,
  type WaitCommandResult,
  type WaitForTextCommandOptions,
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
  type InteractionTarget,
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
import {
  bootCommand,
  devicesCommand,
  ensureSimulatorCommand,
  installCommand,
  installFromSourceCommand,
  reinstallCommand,
  type AdminBootCommandOptions,
  type AdminBootCommandResult,
  type AdminDevicesCommandOptions,
  type AdminDevicesCommandResult,
  type AdminEnsureSimulatorCommandOptions,
  type AdminEnsureSimulatorCommandResult,
  type AdminInstallCommandOptions,
  type AdminInstallCommandResult,
  type AdminInstallFromSourceCommandOptions,
  type AdminReinstallCommandOptions,
} from './admin.ts';
import {
  recordCommand,
  traceCommand,
  type RecordingRecordCommandOptions,
  type RecordingRecordCommandResult,
  type RecordingTraceCommandOptions,
  type RecordingTraceCommandResult,
} from './recording.ts';
import {
  logsCommand,
  networkCommand,
  perfCommand,
  type DiagnosticsLogsCommandOptions,
  type DiagnosticsLogsCommandResult,
  type DiagnosticsNetworkCommandOptions,
  type DiagnosticsNetworkCommandResult,
  type DiagnosticsPerfCommandOptions,
  type DiagnosticsPerfCommandResult,
} from './diagnostics.ts';

export type { ScreenshotCommandResult } from './capture-screenshot.ts';
export type {
  DiffScreenshotCommandOptions,
  DiffScreenshotCommandResult,
  LiveScreenshotInputRef,
} from './capture-diff-screenshot.ts';
export type {
  DiffSnapshotCommandResult,
  SnapshotCommandResult,
  SnapshotDiffLine,
  SnapshotDiffSummary,
} from './capture-snapshot.ts';
export type {
  FindReadCommandOptions,
  FindReadCommandResult,
  GetAttrsCommandOptions,
  GetCommandOptions,
  GetCommandResult,
  GetTextCommandOptions,
  IsCommandOptions,
  IsCommandResult,
  IsSelectorCommandOptions,
  ElementTarget,
  RefTarget,
  ResolvedTarget,
  SelectorTarget,
  SelectorSnapshotOptions,
  WaitCommandOptions,
  WaitCommandResult,
  WaitForTextCommandOptions,
} from './selector-read.ts';
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
} from './interactions.ts';
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
} from './system.ts';
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
} from './apps.ts';
export type {
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
export type {
  RecordingRecordCommandOptions,
  RecordingRecordCommandResult,
  RecordingTraceCommandOptions,
  RecordingTraceCommandResult,
} from './recording.ts';
export type {
  DiagnosticsLogsCommandOptions,
  DiagnosticsLogsCommandResult,
  DiagnosticsNetworkCommandOptions,
  DiagnosticsNetworkCommandResult,
  DiagnosticsPerfCommandOptions,
  DiagnosticsPerfCommandResult,
} from './diagnostics.ts';
export { ref, selector } from './selector-read.ts';

export type {
  BoundRuntimeCommand,
  CommandResult,
  DiffSnapshotCommandOptions,
  RuntimeCommand,
  ScreenshotCommandOptions,
  SnapshotCommandOptions,
} from './runtime-types.ts';

export type AgentDeviceCommands = {
  capture: {
    screenshot: RuntimeCommand<ScreenshotCommandOptions, ScreenshotCommandResult>;
    diffScreenshot: RuntimeCommand<DiffScreenshotCommandOptions, DiffScreenshotCommandResult>;
    snapshot: RuntimeCommand<SnapshotCommandOptions, SnapshotCommandResult>;
    diffSnapshot: RuntimeCommand<DiffSnapshotCommandOptions, DiffSnapshotCommandResult>;
  };
  selectors: {
    find: RuntimeCommand<FindReadCommandOptions, FindReadCommandResult>;
    get: RuntimeCommand<GetCommandOptions, GetCommandResult>;
    getText: RuntimeCommand<GetTextCommandOptions, Extract<GetCommandResult, { kind: 'text' }>>;
    getAttrs: RuntimeCommand<GetAttrsCommandOptions, Extract<GetCommandResult, { kind: 'attrs' }>>;
    is: RuntimeCommand<IsCommandOptions, IsCommandResult>;
    isVisible: RuntimeCommand<IsSelectorCommandOptions, IsCommandResult>;
    isHidden: RuntimeCommand<IsSelectorCommandOptions, IsCommandResult>;
    wait: RuntimeCommand<WaitCommandOptions, WaitCommandResult>;
    waitForText: RuntimeCommand<
      WaitForTextCommandOptions,
      Extract<WaitCommandResult, { kind: 'text' }>
    >;
  };
  interactions: {
    click: RuntimeCommand<ClickCommandOptions, PressCommandResult>;
    press: RuntimeCommand<PressCommandOptions, PressCommandResult>;
    fill: RuntimeCommand<FillCommandOptions, FillCommandResult>;
    typeText: RuntimeCommand<TypeTextCommandOptions, TypeTextCommandResult>;
    focus: RuntimeCommand<FocusCommandOptions, FocusCommandResult>;
    longPress: RuntimeCommand<LongPressCommandOptions, LongPressCommandResult>;
    swipe: RuntimeCommand<SwipeCommandOptions, SwipeCommandResult>;
    scroll: RuntimeCommand<ScrollCommandOptions, ScrollCommandResult>;
    pinch: RuntimeCommand<PinchCommandOptions, PinchCommandResult>;
  };
  system: {
    back: RuntimeCommand<SystemBackCommandOptions | undefined, SystemBackCommandResult>;
    home: RuntimeCommand<SystemHomeCommandOptions | undefined, SystemHomeCommandResult>;
    rotate: RuntimeCommand<SystemRotateCommandOptions, SystemRotateCommandResult>;
    keyboard: RuntimeCommand<SystemKeyboardCommandOptions | undefined, SystemKeyboardCommandResult>;
    clipboard: RuntimeCommand<SystemClipboardCommandOptions, SystemClipboardCommandResult>;
    settings: RuntimeCommand<SystemSettingsCommandOptions | undefined, SystemSettingsCommandResult>;
    alert: RuntimeCommand<SystemAlertCommandOptions | undefined, SystemAlertCommandResult>;
    appSwitcher: RuntimeCommand<
      SystemAppSwitcherCommandOptions | undefined,
      SystemAppSwitcherCommandResult
    >;
  };
  apps: {
    open: RuntimeCommand<OpenAppCommandOptions, OpenAppCommandResult>;
    close: RuntimeCommand<CloseAppCommandOptions | undefined, CloseAppCommandResult>;
    list: RuntimeCommand<ListAppsCommandOptions | undefined, ListAppsCommandResult>;
    state: RuntimeCommand<GetAppStateCommandOptions, GetAppStateCommandResult>;
    push: RuntimeCommand<PushAppCommandOptions, PushAppCommandResult>;
    triggerEvent: RuntimeCommand<TriggerAppEventCommandOptions, TriggerAppEventCommandResult>;
  };
  admin: {
    devices: RuntimeCommand<AdminDevicesCommandOptions | undefined, AdminDevicesCommandResult>;
    boot: RuntimeCommand<AdminBootCommandOptions | undefined, AdminBootCommandResult>;
    ensureSimulator: RuntimeCommand<
      AdminEnsureSimulatorCommandOptions,
      AdminEnsureSimulatorCommandResult
    >;
    install: RuntimeCommand<AdminInstallCommandOptions, AdminInstallCommandResult>;
    reinstall: RuntimeCommand<AdminReinstallCommandOptions, AdminInstallCommandResult>;
    installFromSource: RuntimeCommand<
      AdminInstallFromSourceCommandOptions,
      AdminInstallCommandResult
    >;
  };
  recording: {
    record: RuntimeCommand<RecordingRecordCommandOptions, RecordingRecordCommandResult>;
    trace: RuntimeCommand<RecordingTraceCommandOptions, RecordingTraceCommandResult>;
  };
  diagnostics: {
    logs: RuntimeCommand<DiagnosticsLogsCommandOptions | undefined, DiagnosticsLogsCommandResult>;
    network: RuntimeCommand<
      DiagnosticsNetworkCommandOptions | undefined,
      DiagnosticsNetworkCommandResult
    >;
    perf: RuntimeCommand<DiagnosticsPerfCommandOptions | undefined, DiagnosticsPerfCommandResult>;
  };
};

export type BoundAgentDeviceCommands = {
  capture: {
    screenshot: BoundRuntimeCommand<ScreenshotCommandOptions, ScreenshotCommandResult>;
    diffScreenshot: BoundRuntimeCommand<DiffScreenshotCommandOptions, DiffScreenshotCommandResult>;
    snapshot: BoundRuntimeCommand<SnapshotCommandOptions, SnapshotCommandResult>;
    diffSnapshot: BoundRuntimeCommand<DiffSnapshotCommandOptions, DiffSnapshotCommandResult>;
  };
  selectors: {
    find: BoundRuntimeCommand<FindReadCommandOptions, FindReadCommandResult>;
    get: BoundRuntimeCommand<GetCommandOptions, GetCommandResult>;
    getText: (
      target: ElementTarget,
      options?: Omit<GetTextCommandOptions, 'target'>,
    ) => Promise<Extract<GetCommandResult, { kind: 'text' }>>;
    getAttrs: (
      target: ElementTarget,
      options?: Omit<GetAttrsCommandOptions, 'target'>,
    ) => Promise<Extract<GetCommandResult, { kind: 'attrs' }>>;
    is: BoundRuntimeCommand<IsCommandOptions, IsCommandResult>;
    isVisible: (
      target: SelectorTarget,
      options?: Omit<IsSelectorCommandOptions, 'target'>,
    ) => Promise<IsCommandResult>;
    isHidden: (
      target: SelectorTarget,
      options?: Omit<IsSelectorCommandOptions, 'target'>,
    ) => Promise<IsCommandResult>;
    wait: BoundRuntimeCommand<WaitCommandOptions, WaitCommandResult>;
    waitForText: (
      text: string,
      options?: Omit<WaitForTextCommandOptions, 'text'>,
    ) => Promise<Extract<WaitCommandResult, { kind: 'text' }>>;
  };
  interactions: {
    click: (
      target: InteractionTarget,
      options?: Omit<ClickCommandOptions, 'target'>,
    ) => Promise<PressCommandResult>;
    press: (
      target: InteractionTarget,
      options?: Omit<PressCommandOptions, 'target'>,
    ) => Promise<PressCommandResult>;
    fill: (
      target: InteractionTarget,
      text: string,
      options?: Omit<FillCommandOptions, 'target' | 'text'>,
    ) => Promise<FillCommandResult>;
    typeText: (
      text: string,
      options?: Omit<TypeTextCommandOptions, 'text'>,
    ) => Promise<TypeTextCommandResult>;
    focus: (
      target: InteractionTarget,
      options?: Omit<FocusCommandOptions, 'target'>,
    ) => Promise<FocusCommandResult>;
    longPress: (
      target: InteractionTarget,
      options?: Omit<LongPressCommandOptions, 'target'>,
    ) => Promise<LongPressCommandResult>;
    swipe: BoundRuntimeCommand<SwipeCommandOptions, SwipeCommandResult>;
    scroll: BoundRuntimeCommand<ScrollCommandOptions, ScrollCommandResult>;
    pinch: BoundRuntimeCommand<PinchCommandOptions, PinchCommandResult>;
  };
  system: {
    back: (options?: SystemBackCommandOptions) => Promise<SystemBackCommandResult>;
    home: (options?: SystemHomeCommandOptions) => Promise<SystemHomeCommandResult>;
    rotate: BoundRuntimeCommand<SystemRotateCommandOptions, SystemRotateCommandResult>;
    keyboard: (options?: SystemKeyboardCommandOptions) => Promise<SystemKeyboardCommandResult>;
    clipboard: BoundRuntimeCommand<SystemClipboardCommandOptions, SystemClipboardCommandResult>;
    settings: (options?: SystemSettingsCommandOptions) => Promise<SystemSettingsCommandResult>;
    alert: (options?: SystemAlertCommandOptions) => Promise<SystemAlertCommandResult>;
    appSwitcher: (
      options?: SystemAppSwitcherCommandOptions,
    ) => Promise<SystemAppSwitcherCommandResult>;
  };
  apps: {
    open: BoundRuntimeCommand<OpenAppCommandOptions, OpenAppCommandResult>;
    close: (options?: CloseAppCommandOptions) => Promise<CloseAppCommandResult>;
    list: (options?: ListAppsCommandOptions) => Promise<ListAppsCommandResult>;
    state: BoundRuntimeCommand<GetAppStateCommandOptions, GetAppStateCommandResult>;
    push: BoundRuntimeCommand<PushAppCommandOptions, PushAppCommandResult>;
    triggerEvent: BoundRuntimeCommand<TriggerAppEventCommandOptions, TriggerAppEventCommandResult>;
  };
  admin: {
    devices: (options?: AdminDevicesCommandOptions) => Promise<AdminDevicesCommandResult>;
    boot: (options?: AdminBootCommandOptions) => Promise<AdminBootCommandResult>;
    ensureSimulator: BoundRuntimeCommand<
      AdminEnsureSimulatorCommandOptions,
      AdminEnsureSimulatorCommandResult
    >;
    install: BoundRuntimeCommand<AdminInstallCommandOptions, AdminInstallCommandResult>;
    reinstall: BoundRuntimeCommand<AdminReinstallCommandOptions, AdminInstallCommandResult>;
    installFromSource: BoundRuntimeCommand<
      AdminInstallFromSourceCommandOptions,
      AdminInstallCommandResult
    >;
  };
  recording: {
    record: BoundRuntimeCommand<RecordingRecordCommandOptions, RecordingRecordCommandResult>;
    trace: BoundRuntimeCommand<RecordingTraceCommandOptions, RecordingTraceCommandResult>;
  };
  observability: {
    logs: (options?: DiagnosticsLogsCommandOptions) => Promise<DiagnosticsLogsCommandResult>;
    network: (
      options?: DiagnosticsNetworkCommandOptions,
    ) => Promise<DiagnosticsNetworkCommandResult>;
    perf: (options?: DiagnosticsPerfCommandOptions) => Promise<DiagnosticsPerfCommandResult>;
  };
};

export const commands: AgentDeviceCommands = {
  capture: {
    screenshot: screenshotCommand,
    diffScreenshot: diffScreenshotCommand,
    snapshot: snapshotCommand,
    diffSnapshot: diffSnapshotCommand,
  },
  selectors: {
    find: findCommand,
    get: getCommand,
    getText: getTextCommand,
    getAttrs: getAttrsCommand,
    is: isCommand,
    isVisible: isVisibleCommand,
    isHidden: isHiddenCommand,
    wait: waitCommand,
    waitForText: waitForTextCommand,
  },
  interactions: {
    click: clickCommand,
    press: pressCommand,
    fill: fillCommand,
    typeText: typeTextCommand,
    focus: focusCommand,
    longPress: longPressCommand,
    swipe: swipeCommand,
    scroll: scrollCommand,
    pinch: pinchCommand,
  },
  system: {
    back: backCommand,
    home: homeCommand,
    rotate: rotateCommand,
    keyboard: keyboardCommand,
    clipboard: clipboardCommand,
    settings: settingsCommand,
    alert: alertCommand,
    appSwitcher: appSwitcherCommand,
  },
  apps: {
    open: openAppCommand,
    close: closeAppCommand,
    list: listAppsCommand,
    state: getAppStateCommand,
    push: pushAppCommand,
    triggerEvent: triggerAppEventCommand,
  },
  admin: {
    devices: devicesCommand,
    boot: bootCommand,
    ensureSimulator: ensureSimulatorCommand,
    install: installCommand,
    reinstall: reinstallCommand,
    installFromSource: installFromSourceCommand,
  },
  recording: {
    record: recordCommand,
    trace: traceCommand,
  },
  diagnostics: {
    logs: logsCommand,
    network: networkCommand,
    perf: perfCommand,
  },
};

export function bindCommands(runtime: AgentDeviceRuntime): BoundAgentDeviceCommands {
  return {
    capture: {
      screenshot: (options) => commands.capture.screenshot(runtime, options),
      diffScreenshot: (options) => commands.capture.diffScreenshot(runtime, options),
      snapshot: (options) => commands.capture.snapshot(runtime, options),
      diffSnapshot: (options) => commands.capture.diffSnapshot(runtime, options),
    },
    selectors: {
      find: (options) => commands.selectors.find(runtime, options),
      get: (options) => commands.selectors.get(runtime, options),
      getText: (target, options = {}) =>
        commands.selectors.getText(runtime, { ...options, target }),
      getAttrs: (target, options = {}) =>
        commands.selectors.getAttrs(runtime, { ...options, target }),
      is: (options) => commands.selectors.is(runtime, options),
      isVisible: (target, options = {}) =>
        commands.selectors.isVisible(runtime, { ...options, target }),
      isHidden: (target, options = {}) =>
        commands.selectors.isHidden(runtime, { ...options, target }),
      wait: (options) => commands.selectors.wait(runtime, options),
      waitForText: (text, options = {}) =>
        commands.selectors.waitForText(runtime, { ...options, text }),
    },
    interactions: {
      click: (target, options = {}) => commands.interactions.click(runtime, { ...options, target }),
      press: (target, options = {}) => commands.interactions.press(runtime, { ...options, target }),
      fill: (target, text, options = {}) =>
        commands.interactions.fill(runtime, { ...options, target, text }),
      typeText: (text, options = {}) =>
        commands.interactions.typeText(runtime, { ...options, text }),
      focus: (target, options = {}) => commands.interactions.focus(runtime, { ...options, target }),
      longPress: (target, options = {}) =>
        commands.interactions.longPress(runtime, { ...options, target }),
      swipe: (options) => commands.interactions.swipe(runtime, options),
      scroll: (options) => commands.interactions.scroll(runtime, options),
      pinch: (options) => commands.interactions.pinch(runtime, options),
    },
    system: {
      back: (options) => commands.system.back(runtime, options),
      home: (options) => commands.system.home(runtime, options),
      rotate: (options) => commands.system.rotate(runtime, options),
      keyboard: (options) => commands.system.keyboard(runtime, options),
      clipboard: (options) => commands.system.clipboard(runtime, options),
      settings: (options) => commands.system.settings(runtime, options),
      alert: (options) => commands.system.alert(runtime, options),
      appSwitcher: (options) => commands.system.appSwitcher(runtime, options),
    },
    apps: {
      open: (options) => commands.apps.open(runtime, options),
      close: (options) => commands.apps.close(runtime, options),
      list: (options) => commands.apps.list(runtime, options),
      state: (options) => commands.apps.state(runtime, options),
      push: (options) => commands.apps.push(runtime, options),
      triggerEvent: (options) => commands.apps.triggerEvent(runtime, options),
    },
    admin: {
      devices: (options) => commands.admin.devices(runtime, options),
      boot: (options) => commands.admin.boot(runtime, options),
      ensureSimulator: (options) => commands.admin.ensureSimulator(runtime, options),
      install: (options) => commands.admin.install(runtime, options),
      reinstall: (options) => commands.admin.reinstall(runtime, options),
      installFromSource: (options) => commands.admin.installFromSource(runtime, options),
    },
    recording: {
      record: (options) => commands.recording.record(runtime, options),
      trace: (options) => commands.recording.trace(runtime, options),
    },
    observability: {
      logs: (options) => commands.diagnostics.logs(runtime, options),
      network: (options) => commands.diagnostics.network(runtime, options),
      perf: (options) => commands.diagnostics.perf(runtime, options),
    },
  };
}
