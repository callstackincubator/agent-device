import type { DeviceRotation } from './device-rotation.ts';
import type { ScrollDirection } from './scroll-gesture.ts';
import type { PermissionSettingOptions } from '../platforms/permission-utils.ts';
import type { SessionSurface } from './session-surface.ts';

export type RunnerContext = {
  requestId?: string;
  appBundleId?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
};

export type BackMode = 'in-app' | 'system';

export type ScreenshotOptions = {
  appBundleId?: string;
  fullscreen?: boolean;
  surface?: SessionSurface;
};

export type Interactor = {
  open(
    app: string,
    options?: { activity?: string; appBundleId?: string; url?: string },
  ): Promise<void>;
  openDevice(): Promise<void>;
  close(app: string): Promise<void>;
  tap(x: number, y: number): Promise<Record<string, unknown> | void>;
  doubleTap(x: number, y: number): Promise<Record<string, unknown> | void>;
  swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs?: number,
  ): Promise<Record<string, unknown> | void>;
  longPress(x: number, y: number, durationMs?: number): Promise<Record<string, unknown> | void>;
  focus(x: number, y: number): Promise<Record<string, unknown> | void>;
  type(text: string, delayMs?: number): Promise<void>;
  fill(
    x: number,
    y: number,
    text: string,
    delayMs?: number,
  ): Promise<Record<string, unknown> | void>;
  scroll(
    direction: ScrollDirection,
    options?: { amount?: number; pixels?: number },
  ): Promise<Record<string, unknown> | void>;
  screenshot(outPath: string, options?: ScreenshotOptions): Promise<void>;
  back(mode?: BackMode): Promise<void>;
  home(): Promise<void>;
  rotate(orientation: DeviceRotation): Promise<void>;
  appSwitcher(): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  setSetting(
    setting: string,
    state: string,
    appId?: string,
    options?: PermissionSettingOptions,
  ): Promise<Record<string, unknown> | void>;
};
