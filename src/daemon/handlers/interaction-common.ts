import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import type { DaemonCommandContext } from '../context.ts';
import type { DaemonRequest } from '../types.ts';
import { SessionStore } from '../session-store.ts';

export type ContextFromFlags = (
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
) => DaemonCommandContext;

export type InteractionHandlerParams = {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  dispatch: typeof dispatchCommand;
};
