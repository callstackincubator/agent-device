import path from 'node:path';
import { formatDurationSeconds } from '../utils/duration-format.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';
import type { RequestProgressEvent } from './request-progress.ts';

export type DaemonProgressEnvelope = {
  type: 'progress';
  event: RequestProgressEvent;
};

export type DaemonResponseEnvelope<TResponse = DaemonResponse> = {
  type: 'response';
  response: TResponse;
};

export function shouldStreamRequestProgress(req: Pick<DaemonRequest, 'meta'>): boolean {
  return req.meta?.requestProgress === 'replay-test';
}

export function isDaemonProgressEnvelope(value: unknown): value is DaemonProgressEnvelope {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'progress' &&
    Boolean((value as { event?: unknown }).event)
  );
}

export function isDaemonResponseEnvelope<TResponse = DaemonResponse>(
  value: unknown,
): value is DaemonResponseEnvelope<TResponse> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'response' &&
    Boolean((value as { response?: unknown }).response)
  );
}

export function serializeDaemonProgressEnvelope(event: RequestProgressEvent): string {
  return `${JSON.stringify({ type: 'progress', event } satisfies DaemonProgressEnvelope)}\n`;
}

export function serializeDaemonResponseEnvelope(response: DaemonResponse): string {
  return `${JSON.stringify({ type: 'response', response } satisfies DaemonResponseEnvelope)}\n`;
}

export function serializeDaemonRpcResponseEnvelope(response: unknown): string {
  return `${JSON.stringify({ type: 'response', response } satisfies DaemonResponseEnvelope<unknown>)}\n`;
}

export function formatRequestProgressEvent(event: RequestProgressEvent): string | undefined {
  if (event.type !== 'replay-test') return undefined;
  const name = formatReplayTestProgressName(event);
  const durationSuffix =
    event.durationMs !== undefined ? ` (${formatReplayProgressDuration(event)})` : '';
  const attemptSuffix = formatReplayProgressAttemptSuffix(event);
  const message = event.message?.replace(/\s+/g, ' ').trim();

  if (event.status === 'pass') {
    return `PASS ${name}${attemptSuffix}${durationSuffix}`;
  }
  if (event.status === 'skip') {
    return [`SKIP ${name}`, message ? `  ${message}` : ''].filter(Boolean).join('\n');
  }

  return [
    `FAIL ${name}${attemptSuffix}${durationSuffix}`,
    message ? `  ${message}` : '',
    event.artifactsDir ? `  artifacts: ${event.artifactsDir}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatReplayTestProgressName(event: RequestProgressEvent): string {
  const title = event.title?.trim();
  if (title) return JSON.stringify(title);
  return path.basename(event.file);
}

function formatReplayProgressAttemptSuffix(event: RequestProgressEvent): string {
  if (event.attempt === undefined) return '';
  if (event.status === 'fail' && event.retrying && event.maxAttempts !== undefined) {
    return ` attempt ${event.attempt}/${event.maxAttempts} retrying`;
  }
  if (event.attempt > 1) return ` after ${event.attempt} attempts`;
  return '';
}

function formatReplayProgressDuration(event: RequestProgressEvent): string {
  const duration = formatDurationSeconds(event.durationMs ?? 0);
  return event.attempt && event.attempt > 1 && !event.retrying ? `total ${duration}` : duration;
}
