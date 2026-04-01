import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseAndroidCpuInfoSample, parseAndroidMemInfoSample } from '../perf.ts';

test('parseAndroidCpuInfoSample aggregates package processes and ignores similar package names', () => {
  const sample = parseAndroidCpuInfoSample(
    [
      'Load: 1.23 / 0.98 / 0.74',
      '12% 1234/com.example.app: 8% user + 4% kernel',
      '3.4% 2468/com.example.app:sync: 2.4% user + 1% kernel',
      '4.5% 1357/com.example.app.debug: 3% user + 1.5% kernel',
      '9.8% 1111/com.example.app2: 6% user + 3.8% kernel',
      '0.7% 999/system_server: 0.5% user + 0.2% kernel',
      '45% TOTAL: 25% user + 20% kernel',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:00.000Z',
  );

  assert.equal(sample.usagePercent, 15.4);
  assert.deepEqual(sample.matchedProcesses, ['com.example.app', 'com.example.app:sync']);
  assert.equal(sample.method, 'adb-shell-dumpsys-cpuinfo');
});

test('parseAndroidMemInfoSample extracts summary and total row metrics from modern meminfo output', () => {
  const sample = parseAndroidMemInfoSample(
    [
      '** MEMINFO in pid 18227 [com.example.app] **',
      '                   Pss  Private  Private  Swapped     Heap     Heap     Heap',
      '                 Total    Dirty    Clean    Dirty     Size    Alloc     Free',
      '                ------   ------   ------   ------   ------   ------   ------',
      '  Native Heap     10468    10408        0        0    20480    14462     6017',
      '        Unknown      185      184        0        0',
      '          TOTAL   216524   208232     4384        0    82916    68345    14570',
      'App Summary',
      '  Java Heap: 55284',
      '  Native Heap: 10468',
      '  Code: 9480',
      '  TOTAL PSS:   216,524            TOTAL RSS:   340,112       TOTAL SWAP PSS:        0',
    ].join('\n'),
    'com.example.app',
    '2026-04-01T10:00:00.000Z',
  );

  assert.equal(sample.totalPssKb, 216524);
  assert.equal(sample.totalRssKb, 340112);
  assert.equal(sample.method, 'adb-shell-dumpsys-meminfo');
});

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
