import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runCliCapture } from './cli-capture.ts';

test('perf prints compact platform-independent frame health summary by default', async () => {
  const result = await runCliCapture(['perf'], async () => ({
    ok: true,
    data: {
      session: 'android-perf',
      platform: 'android',
      device: 'Pixel',
      metrics: {
        fps: {
          available: true,
          droppedFramePercent: 7.6,
          droppedFrameCount: 637,
          totalFrameCount: 8407,
          sampleWindowMs: 615390,
          method: 'adb-shell-dumpsys-gfxinfo-framestats',
          source: 'android-gfxinfo-summary',
          worstWindows: [
            {
              startOffsetMs: 1200,
              endOffsetMs: 2100,
              missedDeadlineFrameCount: 8,
              worstFrameMs: 84,
            },
          ],
        },
        memory: {
          available: true,
          totalPssKb: 250000,
        },
        cpu: {
          available: true,
          usagePercent: 13,
        },
      },
    },
  }));

  assert.equal(result.code, null);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines[0], 'Frame health: dropped 7.6% (637/8407 frames) window 10m 15s');
  assert.equal(lines[1], 'Worst windows:');
  assert.equal(lines[2], '- +1s-+2s: 8 missed-deadline frames, worst 84ms');
  assert.doesNotMatch(result.stdout, /android|Pixel|memory|cpu|gfxinfo/i);
});

test('perf prints unavailable frame health reason by default', async () => {
  const result = await runCliCapture(['perf'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason: 'Dropped-frame sampling is currently available only on Android.',
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(
    result.stdout,
    'Frame health: unavailable - Dropped-frame sampling is currently available only on Android.\n',
  );
});

test('perf prints compact CPU and memory summary when frame health is unavailable', async () => {
  const result = await runCliCapture(['perf'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason: 'Dropped-frame sampling is currently available only on Android.',
        },
        memory: {
          available: true,
          residentMemoryKb: 250000,
        },
        cpu: {
          available: true,
          usagePercent: 12.5,
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.stdout, 'Performance: CPU 12.5%, memory 244MB\n');
});
