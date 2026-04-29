import type { SessionAction, SessionState } from '../types.ts';
import { normalizeError } from '../../utils/errors.ts';
import {
  ANDROID_CPU_SAMPLE_DESCRIPTION,
  ANDROID_CPU_SAMPLE_METHOD,
  ANDROID_FRAME_SAMPLE_DESCRIPTION,
  ANDROID_FRAME_SAMPLE_METHOD,
  ANDROID_MEMORY_SAMPLE_DESCRIPTION,
  ANDROID_MEMORY_SAMPLE_METHOD,
  sampleAndroidCpuPerf,
  sampleAndroidFramePerf,
  sampleAndroidMemoryPerf,
} from '../../platforms/android/perf.ts';
import {
  buildAppleSamplingMetadata,
  sampleAppleFramePerf,
  sampleApplePerfMetrics,
} from '../../platforms/ios/perf.ts';
import {
  PERF_STARTUP_SAMPLE_LIMIT,
  PERF_UNAVAILABLE_REASON,
  STARTUP_SAMPLE_DESCRIPTION,
  STARTUP_SAMPLE_METHOD,
  type StartupPerfSample,
} from './session-startup-metrics.ts';

type SettledMetricResult = PromiseSettledResult<Record<string, unknown>>;
type MetricResult =
  | ({ available: true } & Record<string, unknown>)
  | { available: false; reason: string; error: ReturnType<typeof normalizeError> };
type PerfResponseData = {
  session: string;
  platform: string;
  device: string;
  deviceId: string;
  metrics: Record<string, unknown>;
  sampling: Record<string, unknown>;
};

const RELATED_PERF_ACTION_LIMIT = 12;

function readStartupPerfSamples(actions: SessionAction[]): StartupPerfSample[] {
  const samples: StartupPerfSample[] = [];
  for (const action of actions) {
    if (action.command !== 'open') continue;
    const startup = action.result?.startup;
    if (!startup || typeof startup !== 'object') continue;
    const record = startup as Record<string, unknown>;
    if (
      typeof record.durationMs !== 'number' ||
      !Number.isFinite(record.durationMs) ||
      typeof record.measuredAt !== 'string' ||
      record.measuredAt.trim().length === 0 ||
      record.method !== STARTUP_SAMPLE_METHOD
    ) {
      continue;
    }
    samples.push({
      durationMs: Math.max(0, Math.round(record.durationMs)),
      measuredAt: record.measuredAt,
      method: STARTUP_SAMPLE_METHOD,
      appTarget:
        typeof record.appTarget === 'string' && record.appTarget.length > 0
          ? record.appTarget
          : undefined,
      appBundleId:
        typeof record.appBundleId === 'string' && record.appBundleId.length > 0
          ? record.appBundleId
          : undefined,
    });
  }
  return samples.slice(-PERF_STARTUP_SAMPLE_LIMIT);
}

export async function buildPerfResponseData(
  session: SessionState,
): Promise<Record<string, unknown>> {
  const response = buildBasePerfResponse(session);

  if (!supportsPlatformPerfMetrics(session)) {
    return response;
  }

  if (!session.appBundleId) {
    applyMissingAppPerfMetrics(response, session);
    return response;
  }

  if (session.device.platform === 'android') {
    await applyAndroidPerfMetrics(response, session);
    return response;
  }

  await applyApplePerfMetrics(response, session);
  return response;
}

function buildBasePerfResponse(session: SessionState): PerfResponseData {
  const startupSamples = readStartupPerfSamples(session.actions);
  const latestStartupSample = startupSamples.at(-1);
  const startupMetric = latestStartupSample
    ? {
        available: true,
        lastDurationMs: latestStartupSample.durationMs,
        lastMeasuredAt: latestStartupSample.measuredAt,
        method: STARTUP_SAMPLE_METHOD,
        sampleCount: startupSamples.length,
        samples: startupSamples,
      }
    : {
        available: false,
        reason: 'No startup sample captured yet. Run open <app|url> in this session first.',
        method: STARTUP_SAMPLE_METHOD,
      };
  return {
    session: session.name,
    platform: session.device.platform,
    device: session.device.name,
    deviceId: session.device.id,
    metrics: {
      startup: startupMetric,
      ...buildDefaultUnavailableMetrics(),
    },
    sampling: {
      startup: {
        method: STARTUP_SAMPLE_METHOD,
        description: STARTUP_SAMPLE_DESCRIPTION,
        unit: 'ms',
      },
      ...buildPlatformSamplingMetadata(session),
    },
  };
}

function buildDefaultUnavailableMetrics(): Record<string, unknown> {
  return {
    fps: {
      available: false,
      reason: 'Dropped-frame sampling is currently available only on Android.',
    },
    memory: { available: false, reason: PERF_UNAVAILABLE_REASON },
    cpu: { available: false, reason: PERF_UNAVAILABLE_REASON },
  };
}

function applyMissingAppPerfMetrics(response: PerfResponseData, session: SessionState): void {
  const reason = buildMissingAppPerfReason(session);
  response.metrics.fps = { available: false, reason };
  response.metrics.memory = { available: false, reason };
  response.metrics.cpu = { available: false, reason };
}

async function applyAndroidPerfMetrics(
  response: PerfResponseData,
  session: SessionState,
): Promise<void> {
  const results = await sampleAndroidPerfResults(session);
  response.metrics.memory = buildMetricResult(results.memory);
  response.metrics.cpu = buildMetricResult(results.cpu);
  response.metrics.fps = enrichFrameMetricWithSessionContext(
    buildMetricResult(results.fps),
    session,
  );
}

async function applyApplePerfMetrics(
  response: PerfResponseData,
  session: SessionState,
): Promise<void> {
  const results = await sampleApplePerfResultsForSession(session);
  response.metrics.memory = buildMetricResult(results.memory);
  response.metrics.cpu = buildMetricResult(results.cpu);
  response.metrics.fps = enrichFrameMetricWithSessionContext(
    buildMetricResult(results.fps),
    session,
  );
}

function supportsPlatformPerfMetrics(session: SessionState): boolean {
  return (
    session.device.platform === 'android' ||
    session.device.platform === 'ios' ||
    session.device.platform === 'macos'
  );
}

function buildMissingAppPerfReason(session: SessionState): string {
  if (session.device.platform === 'android') {
    return 'No Android app package is associated with this session. Run open <app> first.';
  }
  return 'No Apple app bundle ID is associated with this session. Run open <app> first.';
}

function buildPlatformSamplingMetadata(session: SessionState): Record<string, unknown> {
  if (session.device.platform === 'android') {
    return {
      memory: {
        method: ANDROID_MEMORY_SAMPLE_METHOD,
        description: ANDROID_MEMORY_SAMPLE_DESCRIPTION,
        unit: 'kB',
      },
      cpu: {
        method: ANDROID_CPU_SAMPLE_METHOD,
        description: ANDROID_CPU_SAMPLE_DESCRIPTION,
        unit: 'percent',
      },
      fps: {
        method: ANDROID_FRAME_SAMPLE_METHOD,
        description: ANDROID_FRAME_SAMPLE_DESCRIPTION,
        unit: 'percent',
        primaryField: 'droppedFramePercent',
        window: 'since previous Android gfxinfo reset or app process start',
        resetsAfterRead: true,
        relatedActionsLimit: RELATED_PERF_ACTION_LIMIT,
      },
    };
  }
  return buildAppleSamplingMetadata(session.device);
}

async function sampleAndroidPerfResults(session: SessionState): Promise<{
  memory: SettledMetricResult;
  cpu: SettledMetricResult;
  fps: SettledMetricResult;
}> {
  const appBundleId = session.appBundleId as string;
  const [memory, cpu, fps] = await Promise.allSettled([
    sampleAndroidMemoryPerf(session.device, appBundleId),
    sampleAndroidCpuPerf(session.device, appBundleId),
    sampleAndroidFramePerf(session.device, appBundleId),
  ]);
  return { memory, cpu, fps };
}

async function sampleApplePerfResultsForSession(session: SessionState): Promise<{
  memory: SettledMetricResult;
  cpu: SettledMetricResult;
  fps: SettledMetricResult;
}> {
  const appBundleId = session.appBundleId as string;
  const fps = await settleMetric(sampleAppleFramePerf(session.device, appBundleId));
  const processSample = await settleMetric(sampleApplePerfMetrics(session.device, appBundleId));
  if (processSample.status === 'fulfilled') {
    const processMetrics = processSample.value as {
      memory: Record<string, unknown>;
      cpu: Record<string, unknown>;
    };
    return {
      memory: { status: 'fulfilled', value: processMetrics.memory },
      cpu: { status: 'fulfilled', value: processMetrics.cpu },
      fps,
    };
  }
  return {
    memory: { status: 'rejected', reason: processSample.reason },
    cpu: { status: 'rejected', reason: processSample.reason },
    fps,
  };
}

async function settleMetric<T extends object>(promise: Promise<T>): Promise<SettledMetricResult> {
  try {
    return { status: 'fulfilled', value: (await promise) as Record<string, unknown> };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function buildMetricResult(result: SettledMetricResult): MetricResult {
  if (result.status === 'fulfilled') {
    return { available: true, ...result.value };
  }
  const error = normalizeError(result.reason);
  return {
    available: false,
    reason: error.message,
    error,
  };
}

function enrichFrameMetricWithSessionContext(
  metric: MetricResult,
  session: SessionState,
): MetricResult {
  if (metric.available !== true) return metric;
  const relatedActions = buildRelatedPerfActions(session.actions, metric);
  if (relatedActions.length === 0) return metric;
  return {
    ...metric,
    relatedActions,
  };
}

function buildRelatedPerfActions(
  actions: SessionAction[],
  metric: Record<string, unknown>,
): Array<{
  command: string;
  at: string;
  offsetMs?: number;
  target?: string;
}> {
  const windowStartedAtMs = parseIsoTime(metric.windowStartedAt);
  const windowEndedAtMs = parseIsoTime(metric.windowEndedAt) ?? parseIsoTime(metric.measuredAt);
  if (windowStartedAtMs === undefined || windowEndedAtMs === undefined) return [];

  return actions
    .filter((action) => action.ts >= windowStartedAtMs && action.ts <= windowEndedAtMs)
    .map((action) => ({
      command: action.command,
      at: new Date(action.ts).toISOString(),
      offsetMs: Math.max(0, Math.round(action.ts - windowStartedAtMs)),
      target: readActionTarget(action),
    }))
    .slice(-RELATED_PERF_ACTION_LIMIT);
}

function parseIsoTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function readActionTarget(action: SessionAction): string | undefined {
  const result = action.result;
  if (!result) return undefined;
  for (const key of ['refLabel', 'ref', 'appName', 'appBundleId']) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
