import path from 'node:path';
import type { RequestProgressEvent } from './daemon/request-progress.ts';
import { formatDurationSeconds } from './utils/duration-format.ts';

export function formatReplayTestProgressEvent(event: RequestProgressEvent): string | undefined {
  if (event.type !== 'replay-test') return undefined;
  if (event.status === 'pass') return undefined;
  if (event.status === 'fail' && !event.retrying) return undefined;

  const name = formatReplayTestProgressName(event);
  const durationSuffix =
    event.durationMs !== undefined ? ` (${formatReplayProgressDuration(event)})` : '';
  const attemptSuffix = formatReplayProgressAttemptSuffix(event);
  const message = event.message?.replace(/\s+/g, ' ').trim();

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
