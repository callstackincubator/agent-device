import type { FileOutputRef } from '../io.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime-contract.ts';

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
