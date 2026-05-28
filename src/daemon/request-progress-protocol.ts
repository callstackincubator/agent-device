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
  const parts = [event.status, `${event.index}/${event.total}`, event.file];
  if (event.attempt !== undefined && event.maxAttempts !== undefined) {
    parts.push(`attempt=${event.attempt}/${event.maxAttempts}`);
  }
  if (event.retrying) parts.push('retry=true');
  if (event.durationMs !== undefined)
    parts.push(`duration=${formatDurationSeconds(event.durationMs)}`);
  if (event.artifactsDir && event.status === 'fail') parts.push(`artifacts=${event.artifactsDir}`);
  const message = event.message?.replace(/\s+/g, ' ').trim();
  if (message) parts.push(message);
  return parts.join(' ');
}

function formatDurationSeconds(durationMs: number): string {
  return `${(Math.max(0, durationMs) / 1000).toFixed(2)}s`;
}
