import { afterEach, expect, test, vi } from 'vitest';
import type { SessionState } from '../../types.ts';

vi.mock('../../../platforms/android/perf.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/android/perf.ts')>();
  return {
    ...actual,
    sampleAndroidMemoryPerf: vi.fn(),
    sampleAndroidCpuPerf: vi.fn(),
    sampleAndroidFramePerf: vi.fn(),
  };
});

import { buildPerfResponseData } from '../session-perf.ts';
import {
  sampleAndroidCpuPerf,
  sampleAndroidFramePerf,
  sampleAndroidMemoryPerf,
} from '../../../platforms/android/perf.ts';

const mockSampleAndroidMemoryPerf = vi.mocked(sampleAndroidMemoryPerf);
const mockSampleAndroidCpuPerf = vi.mocked(sampleAndroidCpuPerf);
const mockSampleAndroidFramePerf = vi.mocked(sampleAndroidFramePerf);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test('buildPerfResponseData adds Android frame health metadata and related actions', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-01T10:00:11.000Z'));
  mockAndroidPerfSamples();

  const data = await buildPerfResponseData(makeAndroidSession());
  assertAndroidPerfMetrics(data.metrics as Record<string, any>);
  assertAndroidPerfSampling(data.sampling as Record<string, any>);
});

function mockAndroidPerfSamples(): void {
  mockSampleAndroidMemoryPerf.mockResolvedValue({
    totalPssKb: 216524,
    totalRssKb: 340112,
    measuredAt: '2026-04-01T10:00:11.000Z',
    method: 'adb-shell-dumpsys-meminfo',
  });
  mockSampleAndroidCpuPerf.mockResolvedValue({
    usagePercent: 9,
    measuredAt: '2026-04-01T10:00:11.000Z',
    method: 'adb-shell-dumpsys-cpuinfo',
    matchedProcesses: ['com.example.app', 'com.example.app:sync'],
  });
  mockSampleAndroidFramePerf.mockResolvedValue({
    droppedFramePercent: 33.3,
    droppedFrameCount: 1,
    totalFrameCount: 3,
    windowStartedAt: '2026-04-01T10:00:10.000Z',
    windowEndedAt: '2026-04-01T10:00:11.000Z',
    measuredAt: '2026-04-01T10:00:11.000Z',
    method: 'adb-shell-dumpsys-gfxinfo-framestats',
    source: 'android-gfxinfo-summary',
  });
}

function assertAndroidPerfMetrics(metrics: Record<string, any>): void {
  expect(metrics.memory?.available).toBe(true);
  expect(metrics.memory?.totalPssKb).toBe(216524);
  expect(metrics.cpu?.available).toBe(true);
  expect(metrics.cpu?.usagePercent).toBe(9);
  expect(metrics.fps?.available).toBe(true);
  expect(metrics.fps?.droppedFramePercent).toBe(33.3);
  expect(metrics.fps?.relatedActions).toEqual([
    {
      at: '2026-04-01T10:00:10.050Z',
      command: 'click',
      offsetMs: 50,
      target: 'Refresh metrics',
    },
  ]);
}

function assertAndroidPerfSampling(sampling: Record<string, any>): void {
  expect(sampling.fps?.primaryField).toBe('droppedFramePercent');
  expect(sampling.fps?.relatedActionsLimit).toBe(12);
}

function makeAndroidSession(): SessionState {
  return {
    name: 'perf-session-android',
    createdAt: Date.now(),
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    },
    appBundleId: 'com.example.app',
    appName: 'Example App',
    actions: [
      {
        ts: new Date('2026-04-01T10:00:10.050Z').getTime(),
        command: 'click',
        positionals: ['@e8'],
        flags: {},
        result: { ref: 'e8', refLabel: 'Refresh metrics' },
      },
    ],
  };
}
