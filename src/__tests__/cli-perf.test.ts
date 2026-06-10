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

test('perf metrics forwards explicit metrics area to daemon', async () => {
  const result = await runCliCapture(['perf', 'metrics', '--json'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason: 'No frame data.',
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['metrics']);
});

test('perf frames forwards frames area and prints focused frame summary', async () => {
  const result = await runCliCapture(['perf', 'frames'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: true,
          droppedFramePercent: 3.1,
          droppedFrameCount: 12,
          totalFrameCount: 390,
          sampleWindowMs: 12_000,
          worstWindows: [],
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['frames']);
  assert.equal(result.stdout, 'Frame health: dropped 3.1% (12/390 frames) window 12s\n');
});

test('perf frames sample forwards explicit sample action to daemon', async () => {
  const result = await runCliCapture(['perf', 'frames', 'sample', '--json'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason: 'No frame data.',
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['frames', 'sample']);
});

test('perf memory sample forwards memory area and prints compact memory summary', async () => {
  const result = await runCliCapture(['perf', 'memory', 'sample'], async () => ({
    ok: true,
    data: {
      metrics: {
        memory: {
          available: true,
          totalPssKb: 216524,
          topConsumers: [{ name: 'Dalvik Heap', pssKb: 120000 }],
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['memory', 'sample']);
  assert.equal(result.stdout, 'Performance: memory 211MB\n');
});

test('perf memory snapshot forwards kind and output path and prints artifact summary', async () => {
  const result = await runCliCapture(
    ['perf', 'memory', 'snapshot', '--kind', 'android-hprof', '--out', 'heap.hprof'],
    async () => ({
      ok: true,
      data: {
        artifact: {
          available: true,
          kind: 'android-hprof',
          path: '/tmp/heap.hprof',
          sizeBytes: 2_500_000,
        },
      },
    }),
  );

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['memory', 'snapshot']);
  assert.equal(result.calls[0]?.flags?.kind, 'android-hprof');
  assert.equal(result.calls[0]?.flags?.out, 'heap.hprof');
  assert.equal(result.stdout, 'Memory artifact (android-hprof): /tmp/heap.hprof (2.4MB)\n');
});

test('perf forwards shared perf kind values through CLI parsing', async () => {
  const result = await runCliCapture(
    ['perf', 'memory', 'snapshot', '--kind', 'perfetto', '--json'],
    async () => ({
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'perf memory snapshot --kind must be android-hprof or memgraph',
      },
    }),
  );

  assert.equal(result.code, 1);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['memory', 'snapshot']);
  assert.equal(result.calls[0]?.flags?.kind, 'perfetto');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'INVALID_ARGS');
});

test('perf cpu profile start forwards xctrace options to daemon positionals', async () => {
  const result = await runCliCapture(
    [
      'perf',
      'cpu',
      'profile',
      'start',
      '--kind',
      'xctrace',
      '--template',
      'Time Profiler',
      '--out',
      'app.trace',
      '--json',
    ],
    async () => ({
      ok: true,
      data: {
        perf: 'started',
        kind: 'xctrace',
        mode: 'cpu-profile',
        outPath: '/tmp/app.trace',
      },
    }),
  );

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, [
    'cpu',
    'profile',
    'start',
    'xctrace',
    'Time Profiler',
    'app.trace',
  ]);
});

test('perf trace stop forwards xctrace trace artifact path', async () => {
  const result = await runCliCapture(
    ['perf', 'trace', 'stop', '--kind', 'xctrace', '--out', 'hitches.trace', '--json'],
    async () => ({
      ok: true,
      data: {
        perf: 'stopped',
        kind: 'xctrace',
        mode: 'trace',
        outPath: '/tmp/hitches.trace',
      },
    }),
  );

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['trace', 'stop', 'xctrace', '', 'hitches.trace']);
});

test('perf cpu profile report preserves the report out path when template is omitted', async () => {
  const result = await runCliCapture(
    [
      'perf',
      'cpu',
      'profile',
      'report',
      '--kind',
      'xctrace',
      '--out',
      'app-profile.json',
      '--json',
    ],
    async () => ({
      ok: true,
      data: {
        perf: 'reported',
        kind: 'xctrace',
        mode: 'cpu-profile',
        reportPath: '/tmp/app-profile.json',
      },
    }),
  );

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, [
    'cpu',
    'profile',
    'report',
    'xctrace',
    '',
    'app-profile.json',
  ]);
});

test('perf xctrace output prints only compact artifact metadata by default', async () => {
  const result = await runCliCapture(
    ['perf', 'cpu', 'profile', 'report', '--kind', 'xctrace', '--out', 'app-profile.json'],
    async () => ({
      ok: true,
      data: {
        perf: 'reported',
        kind: 'xctrace',
        mode: 'cpu-profile',
        reportPath: '/tmp/app-profile.json',
        tracePath: '/tmp/app.trace',
        summary: {
          tableSchemas: ['time-profile'],
        },
      },
    }),
  );

  assert.equal(result.code, null);
  assert.equal(result.stdout, '/tmp/app-profile.json\nPerf cpu-profile: reported\n');
  assert.doesNotMatch(result.stdout, /time-profile|app\.trace/);
});

test('perf sample defaults to metrics sample', async () => {
  const result = await runCliCapture(['perf', 'sample', '--json'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason: 'No frame data.',
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['metrics', 'sample']);
});

test('perf area and action positionals are case-insensitive', async () => {
  const result = await runCliCapture(['perf', 'FRAMES', 'SAMPLE', '--json'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason: 'No frame data.',
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls[0]?.command, 'perf');
  assert.deepEqual(result.calls[0]?.positionals, ['frames', 'sample']);
});

test('perf rejects incomplete native CLI area before daemon dispatch', async () => {
  const result = await runCliCapture(['perf', 'cpu', '--json'], async () => ({
    ok: true,
    data: {},
  }));

  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /perf cpu requires profile/i);
});

test('perf prints unavailable frame health reason by default', async () => {
  const result = await runCliCapture(['perf'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason:
            'Dropped-frame sampling is currently available only on Android app sessions and connected iOS device app sessions.',
        },
      },
    },
  }));

  assert.equal(result.code, null);
  assert.equal(
    result.stdout,
    'Frame health: unavailable - Dropped-frame sampling is currently available only on Android app sessions and connected iOS device app sessions.\n',
  );
});

test('perf prints compact CPU and memory summary when frame health is unavailable', async () => {
  const result = await runCliCapture(['perf'], async () => ({
    ok: true,
    data: {
      metrics: {
        fps: {
          available: false,
          reason:
            'Dropped-frame sampling is currently available only on Android app sessions and connected iOS device app sessions.',
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
