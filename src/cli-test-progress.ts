import path from 'node:path';
import type { RequestProgressEvent } from './daemon/request-progress.ts';
import { formatDurationSeconds } from './utils/duration-format.ts';

type ReplayTestCaseProgressEvent = Extract<RequestProgressEvent, { type: 'replay-test' }>;
type ReplayTestCaseStatus = ReplayTestCaseProgressEvent['status'];

const REPLAY_TEST_STATUS_LABELS: Record<ReplayTestCaseStatus, string> = {
  start: 'START',
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

export function formatReplayTestProgressEvent(event: RequestProgressEvent): string | undefined {
  if (event.type === 'replay-test-suite') {
    return formatReplayTestSuiteProgressEvent(event);
  }
  const eventType = (event as { type?: string }).type;
  if (eventType !== 'replay-test') {
    return undefined;
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

function formatReplayTestCaseProgressEvent(event: ReplayTestCaseProgressEvent): string {
  const lines = [formatReplayTestCaseSummaryLine(event)];
  addReplayTestCaseDetailLines(lines, event);
  return lines.join('\n');
}

function addReplayTestCaseDetailLines(lines: string[], event: ReplayTestCaseProgressEvent): void {
  if (event.status === 'start') {
    if (event.session) lines.push(`  session: ${event.session}`);
    if (event.artifactsDir) lines.push(`  artifacts: ${event.artifactsDir}`);
    return;
  }

  const message = event.message?.replace(/\s+/g, ' ').trim();
  if (message) lines.push(`  ${message}`);
  if (event.status === 'fail' && !event.retrying) {
    if (event.session) lines.push(`  session: ${event.session}`);
    if (event.artifactsDir) lines.push(`  artifacts: ${event.artifactsDir}`);
  }
}

function formatReplayTestCaseSummaryLine(event: ReplayTestCaseProgressEvent): string {
  const indexPrefix = `[${event.index}/${event.total}]`;
  const statusLabel = formatReplayTestProgressStatusLabel(event);
  const name = formatReplayTestProgressName(event);
  const shardSuffix = formatReplayTestProgressShardSuffix(event);
  const attemptSuffix = formatReplayProgressAttemptSuffix(event);
  const durationSuffix =
    event.durationMs !== undefined ? ` (${formatReplayProgressDuration(event)})` : '';
  return `${indexPrefix} ${statusLabel} ${name}${shardSuffix}${attemptSuffix}${durationSuffix}`;
}

function formatReplayTestProgressName(event: ReplayTestCaseProgressEvent): string {
  const title = event.title?.trim();
  const file = path.basename(event.file);
  return title ? `${JSON.stringify(title)} in ${file}` : file;
}

function formatReplayTestProgressStatusLabel(event: ReplayTestCaseProgressEvent): string {
  return event.retrying ? 'RETRY' : REPLAY_TEST_STATUS_LABELS[event.status];
}

function formatReplayTestProgressShardSuffix(event: ReplayTestCaseProgressEvent): string {
  if (typeof event.shardIndex !== 'number') return '';
  const shardCount = typeof event.shardCount === 'number' ? event.shardCount : '?';
  const device = typeof event.deviceId === 'string' ? ` ${event.deviceId}` : '';
  return ` [shard ${event.shardIndex + 1}/${shardCount}${device}]`;
}

function formatReplayProgressAttemptSuffix(event: ReplayTestCaseProgressEvent): string {
  if (event.attempt === undefined) return '';
  if (event.status === 'start') return '';
  if (event.status === 'fail' && event.retrying && event.maxAttempts !== undefined) {
    return ` attempt ${event.attempt}/${event.maxAttempts}`;
  }
  if (event.attempt > 1) return ` after ${event.attempt} attempts`;
  return '';
}

function formatReplayProgressDuration(event: ReplayTestCaseProgressEvent): string {
  const duration = formatDurationSeconds(event.durationMs ?? 0);
  return event.attempt && event.attempt > 1 && !event.retrying ? `total ${duration}` : duration;
}
