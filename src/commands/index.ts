import type { FileOutputRef } from '../io.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime.ts';
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
  pressCommand,
  typeTextCommand,
  type ClickCommandOptions,
  type FillCommandOptions,
  type FillCommandResult,
  type InteractionTarget,
  type PressCommandOptions,
  type PressCommandResult,
  type TypeTextCommandOptions,
  type TypeTextCommandResult,
} from './interactions.ts';
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
  InteractionTarget,
  PointTarget,
  PressCommandOptions,
  PressCommandResult,
  TypeTextCommandOptions,
  TypeTextCommandResult,
} from './interactions.ts';
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
export { ref, selector } from './selector-read.ts';
export { commandCatalog } from './catalog.ts';
export type { CommandCatalogEntry } from './catalog.ts';
export { createCommandRouter } from './router.ts';
export type {
  CommandRouter,
  CommandRouterConfig,
  CommandRouterRequest,
  CommandRouterResponse,
  CommandRouterResult,
} from './router.ts';

export type CommandResult = Record<string, unknown>;
export type RuntimeCommand<TOptions = Record<string, unknown>, TResult = CommandResult> = (
  runtime: AgentDeviceRuntime,
  options: TOptions,
) => Promise<TResult>;
export type BoundRuntimeCommand<TOptions = Record<string, unknown>, TResult = CommandResult> = (
  options: TOptions,
) => Promise<TResult>;

export type ScreenshotCommandOptions = CommandContext & {
  out?: FileOutputRef;
  fullscreen?: boolean;
  overlayRefs?: boolean;
  appId?: string;
  appBundleId?: string;
  surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
};

export type SnapshotCommandOptions = CommandContext & {
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
};

export type DiffSnapshotCommandOptions = SnapshotCommandOptions;

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
  };
  apps: {
    open: RuntimeCommand<OpenAppCommandOptions, OpenAppCommandResult>;
    close: RuntimeCommand<CloseAppCommandOptions | undefined, CloseAppCommandResult>;
    list: RuntimeCommand<ListAppsCommandOptions | undefined, ListAppsCommandResult>;
    state: RuntimeCommand<GetAppStateCommandOptions, GetAppStateCommandResult>;
    push: RuntimeCommand<PushAppCommandOptions, PushAppCommandResult>;
    triggerEvent: RuntimeCommand<TriggerAppEventCommandOptions, TriggerAppEventCommandResult>;
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
  };
  apps: {
    open: BoundRuntimeCommand<OpenAppCommandOptions, OpenAppCommandResult>;
    close: (options?: CloseAppCommandOptions) => Promise<CloseAppCommandResult>;
    list: (options?: ListAppsCommandOptions) => Promise<ListAppsCommandResult>;
    state: BoundRuntimeCommand<GetAppStateCommandOptions, GetAppStateCommandResult>;
    push: BoundRuntimeCommand<PushAppCommandOptions, PushAppCommandResult>;
    triggerEvent: BoundRuntimeCommand<TriggerAppEventCommandOptions, TriggerAppEventCommandResult>;
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
  },
  apps: {
    open: openAppCommand,
    close: closeAppCommand,
    list: listAppsCommand,
    state: getAppStateCommand,
    push: pushAppCommand,
    triggerEvent: triggerAppEventCommand,
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
    },
    apps: {
      open: (options) => commands.apps.open(runtime, options),
      close: (options) => commands.apps.close(runtime, options),
      list: (options) => commands.apps.list(runtime, options),
      state: (options) => commands.apps.state(runtime, options),
      push: (options) => commands.apps.push(runtime, options),
      triggerEvent: (options) => commands.apps.triggerEvent(runtime, options),
    },
  };
}
