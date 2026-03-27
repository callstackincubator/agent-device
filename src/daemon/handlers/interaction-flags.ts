import type { CommandFlags } from '../../core/dispatch.ts';
import type { DaemonResponse } from '../types.ts';

const REF_UNSUPPORTED_FLAG_MAP: ReadonlyArray<[keyof CommandFlags, string]> = [
  ['snapshotDepth', '--depth'],
  ['snapshotScope', '--scope'],
  ['snapshotRaw', '--raw'],
];

export function refSnapshotFlagGuardResponse(
  command: 'press' | 'fill' | 'get' | 'scrollintoview',
  flags: CommandFlags | undefined,
): DaemonResponse | null {
  const unsupported = unsupportedRefSnapshotFlags(flags);
  if (unsupported.length === 0) return null;
  return {
    ok: false,
    error: {
      code: 'INVALID_ARGS',
      message: `${command} @ref does not support ${unsupported.join(', ')}.`,
    },
  };
}

export type RefSnapshotFlagGuardResponse = typeof refSnapshotFlagGuardResponse;

export function unsupportedRefSnapshotFlags(flags: CommandFlags | undefined): string[] {
  if (!flags) return [];
  const unsupported: string[] = [];
  for (const [key, label] of REF_UNSUPPORTED_FLAG_MAP) {
    if (flags[key] !== undefined) unsupported.push(label);
  }
  return unsupported;
}
