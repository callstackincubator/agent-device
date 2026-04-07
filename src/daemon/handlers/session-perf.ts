import type { SessionAction, SessionState } from '../types.ts';
import { normalizeError } from '../../utils/errors.ts';
import {
  ANDROID_CPU_SAMPLE_DESCRIPTION,
  ANDROID_CPU_SAMPLE_METHOD,
  ANDROID_MEMORY_SAMPLE_DESCRIPTION,
  ANDROID_MEMORY_SAMPLE_METHOD,
  sampleAndroidCpuPerf,
  sampleAndroidMemoryPerf,
} from '../../platforms/android/perf.ts';
import { buildAppleSamplingMetadata, sampleApplePerfMetrics } from '../../platforms/ios/perf.ts';
import {
  PERF_STARTUP_SAMPLE_LIMIT,
  PERF_UNAVAILABLE_REASON,
  STARTUP_SAMPLE_DESCRIPTION,
  STARTUP_SAMPLE_METHOD,
  type StartupPerfSample,
} from './session-startup-metrics.ts';

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
  const defaultUnavailableMetrics = {
    fps: { available: false, reason: PERF_UNAVAILABLE_REASON },
    memory: { available: false, reason: PERF_UNAVAILABLE_REASON },
    cpu: { available: false, reason: PERF_UNAVAILABLE_REASON },
  };

  const response: {
    session: string;
    platform: string;
    device: string;
    deviceId: string;
    metrics: Record<string, unknown>;
    sampling: Record<string, unknown>;
  } = {
    session: session.name,
    platform: session.device.platform,
    device: session.device.name,
    deviceId: session.device.id,
    metrics: {
      startup: startupMetric,
      ...defaultUnavailableMetrics,
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

  if (!supportsPlatformPerfMetrics(session)) {
    return response;
  }

  if (!session.appBundleId) {
    const reason = buildMissingAppPerfReason(session);
    response.metrics.memory = { available: false, reason };
    response.metrics.cpu = { available: false, reason };
    return response;
  }

  const [memoryResult, cpuResult] = await samplePlatformPerfResults(session);
  response.metrics.memory = buildMetricResult(memoryResult);
  response.metrics.cpu = buildMetricResult(cpuResult);
  return response;
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
    };
  }
  return buildAppleSamplingMetadata(session.device);
}

async function samplePlatformPerfResults(
  session: SessionState,
): Promise<
  [PromiseSettledResult<Record<string, unknown>>, PromiseSettledResult<Record<string, unknown>>]
> {
  const appBundleId = session.appBundleId as string;
  if (session.device.platform === 'android') {
    const [memoryResult, cpuResult] = await Promise.allSettled([
      sampleAndroidMemoryPerf(session.device, appBundleId),
      sampleAndroidCpuPerf(session.device, appBundleId),
    ]);
    return [memoryResult, cpuResult];
  }

  try {
    const sample = await sampleApplePerfMetrics(session.device, appBundleId);
    return [
      { status: 'fulfilled', value: sample.memory },
      { status: 'fulfilled', value: sample.cpu },
    ];
  } catch (reason) {
    return [
      { status: 'rejected', reason },
      { status: 'rejected', reason },
    ];
  }
}

function buildMetricResult<T extends Record<string, unknown>>(
  result: PromiseSettledResult<T>,
):
  | ({ available: true } & T)
  | { available: false; reason: string; error: ReturnType<typeof normalizeError> } {
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
