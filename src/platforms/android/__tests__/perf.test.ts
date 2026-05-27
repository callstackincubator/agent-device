import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseAndroidFramePerfSample, parseAndroidMemInfoSample } from '../perf.ts';

test('parseAndroidMemInfoSample supports legacy total row layout', () => {
  const sample = parseAndroidMemInfoSample(
    [
      '** MEMINFO in pid 9953 [com.example.app] **',
      '                 Pss     Pss  Shared Private  Shared Private    Heap    Heap    Heap',
      '               Total   Clean   Dirty   Dirty   Clean   Clean    Size   Alloc    Free',
      '              ------  ------  ------  ------  ------  ------  ------  ------  ------',
      '    Dalvik Heap   5110(3)    0    4136    4988(3)    0       0    9168    8958(6)  210',
      // Legacy dumpsys output may annotate values with "(N)" counters after the numeric token.
      '         TOTAL  24358(1) 4188    9724   17972(2) 16388    4260(2) 16968   16595     336',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:00.000Z',
  );

  assert.equal(sample.totalPssKb, 24358);
  assert.equal(sample.totalRssKb, undefined);
});

test('parseAndroidFramePerfSample summarizes dropped frame percentage from framestats rows', () => {
  const sample = parseAndroidFramePerfSample(
    [
      'Stats since: 123456789ns',
      '---PROFILEDATA---',
      'Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted',
      '0,1000000000,1000000000,0,0,0,0,0,0,0,0,0,0,1010000000,0,0,1010000000',
      '0,1016666667,1016666667,0,0,0,0,0,0,0,0,0,0,1034666667,0,0,1034666667',
      '0,1033333334,1033333334,0,0,0,0,0,0,0,0,0,0,1063333334,0,0,1063333334',
      '1,1050000001,1050000001,0,0,0,0,0,0,0,0,0,0,1100000001,0,0,1100000001',
      '0,1066666668,1066666668,0,0,0,0,0,0,0,0,0,0,1082666668,0,0,1082666668',
      '---PROFILEDATA---',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:00.000Z',
  );

  assert.equal(sample.droppedFrameCount, 2);
  assert.equal(sample.totalFrameCount, 4);
  assert.equal(sample.droppedFramePercent, 50);
  assert.equal(sample.frameDeadlineMs, 16.7);
  assert.equal(sample.refreshRateHz, 60);
  assert.equal(sample.method, 'adb-shell-dumpsys-gfxinfo-framestats');
  assert.equal(sample.source, 'framestats-rows');
  assert.equal(sample.worstWindows?.[0]?.missedDeadlineFrameCount, 2);
});

test('parseAndroidFramePerfSample prefers Android gfxinfo janky frame summary', () => {
  const sample = parseAndroidFramePerfSample(
    [
      'Applications Graphics Acceleration Info:',
      'Uptime: 164892458 Realtime: 164892458',
      '',
      '** Graphics info for pid 16305 [host.exp.exponent] **',
      '',
      'Stats since: 164496032562094ns',
      'Total frames rendered: 4569',
      'Janky frames: 115 (2.52%)',
      'Janky frames (legacy): 3971 (86.91%)',
      'Number Frame deadline missed: 115',
      'Profile data in ms:',
      'Flags,IntendedVsync,FrameCompleted',
      '0,1000000000,1010000000',
    ].join('\n'),
    'host.exp.exponent',
    '2026-04-01T10:00:00.000Z',
  );

  assert.equal(sample.droppedFrameCount, 115);
  assert.equal(sample.totalFrameCount, 4569);
  assert.equal(sample.droppedFramePercent, 2.5);
  assert.equal(sample.source, 'android-gfxinfo-summary');
});

test('parseAndroidFramePerfSample omits frame deadline when rows are too sparse', () => {
  const sample = parseAndroidFramePerfSample(
    [
      'Applications Graphics Acceleration Info:',
      'Uptime: 11000 Realtime: 11000',
      'Stats since: 10000000000ns',
      'Total frames rendered: 3',
      'Janky frames: 1 (33.33%)',
      'Profile data in ms:',
      'Flags,IntendedVsync,FrameCompleted',
      '0,10000000000,10012000000',
      '0,10150000000,10162000000',
      '0,10300000000,10312000000',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:11.000Z',
  );

  assert.equal(sample.droppedFramePercent, 33.3);
  assert.equal(sample.frameDeadlineMs, undefined);
  assert.equal(sample.refreshRateHz, undefined);
  assert.equal(sample.worstWindows?.[0]?.missedDeadlineFrameCount, 1);
});

test('parseAndroidFramePerfSample caps worst windows to Android summary count', () => {
  const sample = parseAndroidFramePerfSample(
    [
      'Applications Graphics Acceleration Info:',
      'Uptime: 11000 Realtime: 11000',
      'Stats since: 10000000000ns',
      'Total frames rendered: 5',
      'Janky frames: 1 (20.00%)',
      'Profile data in ms:',
      'Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted',
      '0,10000000000,10000000000,0,0,0,0,0,0,0,0,0,0,10018000000,0,0,10018000000',
      '0,10016666667,10016666667,0,0,0,0,0,0,0,0,0,0,10036666667,0,0,10036666667',
      '0,10033333334,10033333334,0,0,0,0,0,0,0,0,0,0,10063333334,0,0,10063333334',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:11.000Z',
  );

  assert.equal(sample.droppedFrameCount, 1);
  assert.equal(sample.worstWindows?.[0]?.missedDeadlineFrameCount, 1);
  assert.equal(sample.worstWindows?.[0]?.worstFrameMs, 30);
});

test('parseAndroidFramePerfSample adds estimated timestamps and worst drop windows', () => {
  const sample = parseAndroidFramePerfSample(
    [
      'Applications Graphics Acceleration Info:',
      'Uptime: 11000 Realtime: 11000',
      '',
      'Stats since: 10000000000ns',
      'Total frames rendered: 5',
      'Janky frames: 2 (40.00%)',
      'Profile data in ms:',
      'Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted',
      '0,10000000000,10000000000,0,0,0,0,0,0,0,0,0,0,10010000000,0,0,10010000000',
      '0,10016666667,10016666667,0,0,0,0,0,0,0,0,0,0,10076666667,0,0,10076666667',
      '0,10033333334,10033333334,0,0,0,0,0,0,0,0,0,0,10043333334,0,0,10043333334',
      '0,10050000001,10050000001,0,0,0,0,0,0,0,0,0,0,10120000001,0,0,10120000001',
      '0,10066666668,10066666668,0,0,0,0,0,0,0,0,0,0,10076666668,0,0,10076666668',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:11.000Z',
  );

  assert.equal(sample.windowStartedAt, '2026-04-01T10:00:10.000Z');
  assert.equal(sample.windowEndedAt, '2026-04-01T10:00:11.000Z');
  assert.equal(sample.timestampSource, 'estimated-from-device-uptime');
  assert.equal(sample.worstWindows?.length, 1);
  assert.equal(sample.worstWindows?.[0]?.startOffsetMs, 17);
  assert.equal(sample.worstWindows?.[0]?.endOffsetMs, 120);
  assert.equal(sample.worstWindows?.[0]?.missedDeadlineFrameCount, 2);
  assert.equal(sample.worstWindows?.[0]?.worstFrameMs, 70);
});

test('parseAndroidFramePerfSample treats a reset idle window as an available zero-frame sample', () => {
  const sample = parseAndroidFramePerfSample(
    [
      'Applications Graphics Acceleration Info:',
      'Uptime: 165130629 Realtime: 165130629',
      'Stats since: 165111622765012ns',
      'Total frames rendered: 0',
      'Janky frames: 0 (0.00%)',
      'Number Frame deadline missed: 0',
    ].join('\n'),
    'host.exp.exponent',
    '2026-04-01T10:00:00.000Z',
  );

  assert.equal(sample.droppedFrameCount, 0);
  assert.equal(sample.totalFrameCount, 0);
  assert.equal(sample.droppedFramePercent, 0);
  assert.equal(sample.source, 'android-gfxinfo-summary');
});
