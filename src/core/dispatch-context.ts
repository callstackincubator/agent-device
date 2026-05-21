import type { CliFlags, DaemonExcludedCliFlag } from '../utils/command-schema.ts';
import type { ScreenshotDispatchFlags } from '../commands/capture-screenshot-options.ts';
import type { ClickButton } from './click-button.ts';
import type { SessionSurface } from './session-surface.ts';

export type BatchStep = {
  command: string;
  positionals?: string[];
  flags?: Partial<CommandFlags>;
  runtime?: unknown;
};

export type CommandFlags = Omit<CliFlags, DaemonExcludedCliFlag> & {
  batchSteps?: BatchStep[];
  replayBackend?: string;
};

export type DispatchContext = ScreenshotDispatchFlags & {
  requestId?: string;
  appBundleId?: string;
  activity?: string;
  launchConsole?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  count?: number;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pixels?: number;
  doubleTap?: boolean;
  clickButton?: ClickButton;
  backMode?: 'in-app' | 'system';
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  surface?: SessionSurface;
  directElementSelector?: {
    key: 'id' | 'label' | 'text' | 'value';
    value: string;
    raw: string;
  };
};
