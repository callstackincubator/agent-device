import path from 'node:path';
import type { RequestProgressEvent } from './daemon/request-progress.ts';
import { formatDurationSeconds } from './utils/duration-format.ts';

export function formatReplayTestProgressEvent(event: RequestProgressEvent): string | undefined {
  if (event.type === 'replay-test-suite') {
    return formatReplayTestSuiteProgressEvent(event);
  }
  return formatReplayTestCaseProgressEvent(event);
}

function formatReplayTestSuiteProgressEvent(
  event: Extract<RequestProgressEvent, { type: 'replay-test-suite' }>,
): string {
  const lines = [`Running replay suite: ${event.total} ${event.total === 1 ? 'file' : 'files'}`];
  if (event.shardMode && event.shardCount && event.shardCount > 1) {
    lines.push(`  sharding: ${event.shardMode} across ${event.shardCount} devices`);
  }
  lines.push(`  artifacts: ${event.artifactsDir}`);
  return lines.join('\n');
}

function formatReplayTestCaseProgressEvent(
  event: Extract<RequestProgressEvent, { type: 'replay-test' }>,
): string {
  const name = formatReplayTestProgressName(event);
  const indexPrefix = `[${event.index}/${event.total}]`;
  const statusLabel = formatReplayTestProgressStatusLabel(event);
  const shardSuffix = formatReplayTestProgressShardSuffix(event);
  const durationSuffix =
    event.durationMs !== undefined ? ` (${formatReplayProgressDuration(event)})` : '';
  const attemptSuffix = formatReplayProgressAttemptSuffix(event);
  const message = event.message?.replace(/\s+/g, ' ').trim();
  const lines = [
    `${indexPrefix} ${statusLabel} ${name}${shardSuffix}${attemptSuffix}${durationSuffix}`,
  ];

  if (event.status === 'start') {
    if (event.session) lines.push(`  session: ${event.session}`);
    if (event.artifactsDir) lines.push(`  artifacts: ${event.artifactsDir}`);
    return lines.join('\n');
  }

  if (message) lines.push(`  ${message}`);
  if (event.status === 'fail' && !event.retrying) {
    if (event.session) lines.push(`  session: ${event.session}`);
    if (event.artifactsDir) lines.push(`  artifacts: ${event.artifactsDir}`);
  }
  return lines.join('\n');
}

function formatReplayTestProgressName(
  event: Extract<RequestProgressEvent, { type: 'replay-test' }>,
): string {
  const title = event.title?.trim();
  const file = path.basename(event.file);
  return title ? `${JSON.stringify(title)} in ${file}` : file;
}

function formatReplayTestProgressStatusLabel(
  event: Extract<RequestProgressEvent, { type: 'replay-test' }>,
): string {
  if (event.status === 'start') return 'START';
  if (event.status === 'pass') return 'PASS';
  if (event.status === 'skip') return 'SKIP';
  return event.retrying ? 'RETRY' : 'FAIL';
}

function formatReplayTestProgressShardSuffix(
  event: Extract<RequestProgressEvent, { type: 'replay-test' }>,
): string {
  if (typeof event.shardIndex !== 'number') return '';
  const shardCount = typeof event.shardCount === 'number' ? event.shardCount : '?';
  const device = typeof event.deviceId === 'string' ? ` ${event.deviceId}` : '';
  return ` [shard ${event.shardIndex + 1}/${shardCount}${device}]`;
}

function formatReplayProgressAttemptSuffix(
  event: Extract<RequestProgressEvent, { type: 'replay-test' }>,
): string {
  if (event.attempt === undefined) return '';
  if (event.status === 'start') return '';
  if (event.status === 'fail' && event.retrying && event.maxAttempts !== undefined) {
    return ` attempt ${event.attempt}/${event.maxAttempts}`;
  }
  if (event.attempt > 1) return ` after ${event.attempt} attempts`;
  return '';
}

function formatReplayProgressDuration(
  event: Extract<RequestProgressEvent, { type: 'replay-test' }>,
): string {
  const duration = formatDurationSeconds(event.durationMs ?? 0);
  return event.attempt && event.attempt > 1 && !event.retrying ? `total ${duration}` : duration;
}
