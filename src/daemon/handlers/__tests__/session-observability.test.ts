import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';
import { handleSessionObservabilityCommands } from '../session-observability.ts';
import type { AndroidAdbExecutor } from '../../../platforms/android/adb-executor.ts';

test('network dump validates include mode directly', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'network',
      positionals: ['dump', '5', 'invalid-mode'],
      flags: {},
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /network include mode must be one of/i);
  }
});

test('network dump accepts explicit include flag and rejects conflicting values', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });

  const okResponse = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'network',
      positionals: ['dump', '5'],
      flags: { networkInclude: 'headers' },
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(okResponse);
  assert.equal(okResponse?.ok, true);
  if (okResponse?.ok) {
    assert.equal(okResponse.data?.include, 'headers');
  }

  const conflictResponse = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'network',
      positionals: ['dump', '5', 'summary'],
      flags: { networkInclude: 'headers' },
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(conflictResponse);
  assert.equal(conflictResponse?.ok, false);
  if (conflictResponse && !conflictResponse.ok) {
    assert.equal(conflictResponse.error.code, 'INVALID_ARGS');
    assert.match(conflictResponse.error.message, /both positionally and via --include/i);
  }
});

test('perf memory sample routes to memory-only Android sampler', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });
  const adbCalls: string[][] = [];
  const androidAdbExecutor: AndroidAdbExecutor = async (args) => {
    adbCalls.push([...args]);
    assert.deepEqual(args, ['shell', 'dumpsys', 'meminfo', 'com.example.app']);
    return {
      stdout: [
        '** MEMINFO in pid 18227 [com.example.app] **',
        '          TOTAL   216524   208232     4384        0    82916    68345    14570',
        'App Summary',
        '  TOTAL PSS:   216,524            TOTAL RSS:   340,112       TOTAL SWAP PSS:        0',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    };
  };

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'perf',
      positionals: ['memory', 'sample'],
      flags: {},
    },
    sessionName: 'android',
    sessionStore,
    androidAdbExecutor,
  });

  assert.ok(response?.ok);
  if (!response?.ok) assert.fail(JSON.stringify(response));
  assert.deepEqual(adbCalls, [['shell', 'dumpsys', 'meminfo', 'com.example.app']]);
  const metrics = response.data?.metrics as Record<string, any>;
  assert.equal(metrics.memory.available, true);
  assert.equal(metrics.memory.totalPssKb, 216524);
  assert.deepEqual(Object.keys(metrics), ['memory']);
});

test('perf memory snapshot resolves relative output and returns Android artifact metadata', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-perf-memory-cwd-'));
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });
  const adbCalls: string[][] = [];
  const androidAdbExecutor: AndroidAdbExecutor = async (args) => {
    adbCalls.push([...args]);
    if (args.join(' ') === 'shell pidof com.example.app') {
      return { stdout: '4242\n', stderr: '', exitCode: 0 };
    }
    if (args.slice(0, 4).join(' ') === 'shell am dumpheap com.example.app') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'pull') {
      fs.writeFileSync(String(args[2]), 'hprof-bytes');
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args.slice(0, 3).join(' ') === 'shell rm -f') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    throw new Error(`unexpected adb call: ${args.join(' ')}`);
  };

  try {
    const response = await handleSessionObservabilityCommands({
      req: {
        token: 't',
        session: 'android',
        command: 'perf',
        positionals: ['memory', 'snapshot'],
        flags: { kind: 'android-hprof', out: 'heap.hprof' },
        meta: { cwd },
      },
      sessionName: 'android',
      sessionStore,
      androidAdbExecutor,
    });

    assert.ok(response?.ok);
    if (!response?.ok) assert.fail(JSON.stringify(response));
    const artifact = response.data?.artifact as Record<string, unknown>;
    assert.equal(artifact.available, true);
    assert.equal(artifact.kind, 'android-hprof');
    assert.equal(artifact.path, path.join(cwd, 'heap.hprof'));
    assert.equal(artifact.sizeBytes, 'hprof-bytes'.length);
    assert.equal(fs.existsSync(path.join(cwd, 'heap.hprof')), true);
    assert.equal(adbCalls.at(-1)?.slice(0, 3).join(' '), 'shell rm -f');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('perf memory snapshot reports physical iOS memgraph as unavailable', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('ios-device', {
    name: 'ios-device',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone',
      kind: 'device',
      booted: true,
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'ios-device',
      command: 'perf',
      positionals: ['memory', 'snapshot'],
      flags: { kind: 'memgraph' },
    },
    sessionName: 'ios-device',
    sessionStore,
  });

  assert.ok(response?.ok);
  if (!response?.ok) assert.fail(JSON.stringify(response));
  const artifact = response.data?.artifact as Record<string, unknown>;
  assert.equal(artifact.available, false);
  assert.match(String(artifact.reason), /Physical iOS device memgraph capture/i);
  const support = response.data?.support as Record<string, unknown>;
  assert.equal(support.memgraph, false);
});

test('perf rejects kind outside memory snapshot at daemon layer', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'perf',
      positionals: ['frames', 'sample'],
      flags: { kind: 'xctrace' },
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /--kind is only supported with perf memory snapshot/i);
  }
});

test('perf memory snapshot rejects non-memory perf kind at daemon layer', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'perf',
      positionals: ['memory', 'snapshot'],
      flags: { kind: 'perfetto' },
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(
      response.error.message,
      /perf memory snapshot --kind must be android-hprof or memgraph/i,
    );
  }
});

test('perf memory snapshot returns artifact-shaped unsupported payload on unsupported platforms', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('linux', {
    name: 'linux',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'linux',
      id: 'linux-host',
      name: 'Linux',
      kind: 'device',
      booted: true,
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'linux',
      command: 'perf',
      positionals: ['memory', 'snapshot'],
      flags: {},
    },
    sessionName: 'linux',
    sessionStore,
  });

  assert.ok(response?.ok);
  if (!response?.ok) assert.fail(JSON.stringify(response));
  assert.equal(response.data?.metrics, undefined);
  const artifact = response.data?.artifact as Record<string, unknown>;
  assert.equal(artifact.available, false);
  assert.equal(artifact.kind, 'memgraph');
  assert.match(String(artifact.reason), /not supported on linux/i);
  const support = response.data?.support as Record<string, unknown>;
  assert.equal(support.memgraph, false);
});
