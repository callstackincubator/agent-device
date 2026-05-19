import { appendOpenActionScriptArgs } from './open-script.ts';
import {
  appendGenericActionScriptArgs,
  appendRecordActionScriptArgs,
  appendRuntimeActionScriptArgs,
  appendScreenshotActionScriptArgs,
  appendSnapshotActionScriptArgs,
} from './script-utils.ts';
import type { SessionAction } from '../daemon/types.ts';

export function formatPortableActionLine(
  action: SessionAction,
  options: { runtimeIncludeAllPositionals?: boolean } = {},
): string {
  const parts: string[] = [action.command];
  if (action.command === 'snapshot') {
    appendSnapshotActionScriptArgs(parts, action);
  } else if (action.command === 'open') {
    appendOpenActionScriptArgs(parts, action);
  } else if (action.command === 'runtime') {
    appendRuntimeActionScriptArgs(parts, action, {
      includeAllPositionals: options.runtimeIncludeAllPositionals,
    });
  } else if (action.command === 'record') {
    appendRecordActionScriptArgs(parts, action);
  } else if (action.command === 'screenshot') {
    appendScreenshotActionScriptArgs(parts, action);
  } else {
    appendGenericActionScriptArgs(parts, action);
  }
  return parts.join(' ');
}
