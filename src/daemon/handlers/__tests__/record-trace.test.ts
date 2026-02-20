import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleRecordTraceCommands } from '../record-trace.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-record-trace-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

test('record start/stop uses iOS runner on physical iOS devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  const session = makeSession(sessionName, {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'My iPhone',
    kind: 'device',
    booted: true,
  });
  sessionStore.set(sessionName, session);

  const runnerCalls: Array<{ command: string; outPath?: string; logPath?: string; traceLogPath?: string }> = [];
  const responseStart = await handleRecordTraceCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'record',
      positionals: ['start', './device.mp4'],
      flags: {},
    },
    sessionName,
    sessionStore,
    logPath: '/tmp/daemon.log',
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async (_device, command, options) => {
        runnerCalls.push({
          command: command.command,
          outPath: command.outPath,
          logPath: options?.logPath,
          traceLogPath: options?.traceLogPath,
        });
        return {};
      },
    },
  });

  assert.ok(responseStart);
  assert.equal(responseStart?.ok, true);
  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0]?.command, 'recordStart');
  assert.match(runnerCalls[0]?.outPath ?? '', /device\.mp4$/);
  assert.equal(runnerCalls[0]?.logPath, '/tmp/daemon.log');
  assert.equal(runnerCalls[0]?.traceLogPath, undefined);
  assert.equal(sessionStore.get(sessionName)?.recording?.platform, 'ios-device-runner');

  const responseStop = await handleRecordTraceCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'record',
      positionals: ['stop'],
      flags: {},
    },
    sessionName,
    sessionStore,
    logPath: '/tmp/daemon.log',
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be used for iOS devices');
      },
      runIosRunnerCommand: async (_device, command, options) => {
        runnerCalls.push({
          command: command.command,
          outPath: command.outPath,
          logPath: options?.logPath,
          traceLogPath: options?.traceLogPath,
        });
        return {};
      },
    },
  });

  assert.ok(responseStop);
  assert.equal(responseStop?.ok, true);
  assert.equal(runnerCalls.length, 2);
  assert.equal(runnerCalls[1]?.command, 'recordStop');
  assert.equal(sessionStore.get(sessionName)?.recording, undefined);
});

test('record uses simctl recordVideo for iOS simulators', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'ios',
    id: 'sim-1',
    name: 'Simulator',
    kind: 'simulator',
    booted: true,
  }));

  let started = false;
  let stopped = false;
  const responseStart = await handleRecordTraceCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'record',
      positionals: ['start', './sim.mp4'],
      flags: {},
    },
    sessionName,
    sessionStore,
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: (cmd, args) => {
        assert.equal(cmd, 'xcrun');
        assert.deepEqual(args.slice(0, 4), ['simctl', 'io', 'sim-1', 'recordVideo']);
        started = true;
        return {
          child: { kill: () => { stopped = true; } } as any,
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for iOS simulators');
      },
    },
  });

  assert.equal(responseStart?.ok, true);
  assert.equal(started, true);

  const responseStop = await handleRecordTraceCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'record',
      positionals: ['stop'],
      flags: {},
    },
    sessionName,
    sessionStore,
    deps: {
      runCmd: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for simulator');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for iOS simulators');
      },
    },
  });

  assert.equal(responseStop?.ok, true);
  assert.equal(stopped, true);
});

test('record keeps android pull + cleanup flow', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android';
  sessionStore.set(sessionName, makeSession(sessionName, {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Android',
    kind: 'emulator',
    booted: true,
  }));

  const adbCalls: Array<string[]> = [];
  await handleRecordTraceCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'record',
      positionals: ['start', './android.mp4'],
      flags: {},
    },
    sessionName,
    sessionStore,
    deps: {
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: (cmd, args) => {
        assert.equal(cmd, 'adb');
        assert.deepEqual(args.slice(0, 4), ['-s', 'emulator-5554', 'shell', 'screenrecord']);
        return {
          child: { kill: () => {} } as any,
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for Android');
      },
    },
  });

  await handleRecordTraceCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'record',
      positionals: ['stop'],
      flags: {},
    },
    sessionName,
    sessionStore,
    deps: {
      runCmd: async (_cmd, args) => {
        adbCalls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runCmdBackground: () => {
        throw new Error('runCmdBackground should not be called on stop for Android');
      },
      runIosRunnerCommand: async () => {
        throw new Error('runner should not be used for Android');
      },
    },
  });

  assert.equal(adbCalls.length, 2);
  assert.match(adbCalls[0]?.join(' '), /pull/);
  assert.match(adbCalls[1]?.join(' '), /shell rm -f/);
});
