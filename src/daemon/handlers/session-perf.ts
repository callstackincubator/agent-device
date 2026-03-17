import type { SessionAction, SessionState } from '../types.ts';
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
      typeof record.durationMs !== 'number'
      || !Number.isFinite(record.durationMs)
      || typeof record.measuredAt !== 'string'
      || record.measuredAt.trim().length === 0
      || record.method !== STARTUP_SAMPLE_METHOD
    ) {
      continue;
    }
    samples.push({
      durationMs: Math.max(0, Math.round(record.durationMs)),
      measuredAt: record.measuredAt,
      method: STARTUP_SAMPLE_METHOD,
      appTarget: typeof record.appTarget === 'string' && record.appTarget.length > 0 ? record.appTarget : undefined,
      appBundleId: typeof record.appBundleId === 'string' && record.appBundleId.length > 0 ? record.appBundleId : undefined,
    });
  }
  return samples.slice(-PERF_STARTUP_SAMPLE_LIMIT);
}

export function buildPerfResponseData(session: SessionState): Record<string, unknown> {
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
      fps: { available: false, reason: PERF_UNAVAILABLE_REASON },
      memory: { available: false, reason: PERF_UNAVAILABLE_REASON },
      cpu: { available: false, reason: PERF_UNAVAILABLE_REASON },
    },
    sampling: {
      startup: {
        method: STARTUP_SAMPLE_METHOD,
        description: STARTUP_SAMPLE_DESCRIPTION,
        unit: 'ms',
      },
    },
  };
}
