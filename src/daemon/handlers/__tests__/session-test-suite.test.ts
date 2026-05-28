import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, DaemonResponseData } from '../../types.ts';
import { type RequestProgressEvent, withRequestProgressSink } from '../../request-progress.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-test-suite-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function expectOkData(response: DaemonResponse | null | undefined): DaemonResponseData {
  expect(response?.ok).toBeTruthy();
  if (!response || !response.ok) throw new Error('Expected successful daemon response.');
  return response.data ?? {};
}

test('test does not retry infrastructure startup failures and stops the suite', async () => {
  const sessionStore = makeSessionStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-suite-infra-fail-'));
  fs.writeFileSync(path.join(root, '01-runner.ad'), 'context platform=ios\nopen "Demo"\n');
  fs.writeFileSync(path.join(root, '02-after.ad'), 'context platform=ios\nopen "Demo"\n');

  const invoked: DaemonRequest[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'test',
      positionals: [root],
      meta: { cwd: root, requestId: 'suite-infra-fail' },
      flags: { retries: 3 },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (req) => {
      invoked.push(req);
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: 'Runner did not accept connection',
          details: { reason: 'IOS_RUNNER_CONNECT_TIMEOUT' },
        },
      };
    },
  });

  const data = expectOkData(response);
  expect(invoked.length).toBe(1);
  expect(data.executed).toBe(1);
  expect(data.failed).toBe(1);
  expect(data.notRun).toBe(1);
  const tests = data.tests as Array<Record<string, unknown>>;
  expect(tests[0]?.status).toBe('failed');
  expect(tests[0]?.attempts).toBe(1);
});

test('test discovers Maestro YAML suites when replay backend is set', async () => {
  const sessionStore = makeSessionStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-suite-maestro-'));
  fs.writeFileSync(
    path.join(root, 'auth-flow.yml'),
    ['appId: demo.app', '---', '- launchApp', ''].join('\n'),
  );

  const invoked: DaemonRequest[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'test',
      positionals: [root],
      flags: { platform: 'android', replayBackend: 'maestro' },
      meta: { cwd: root, requestId: 'maestro-suite' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (req) => {
      invoked.push(req);
      return { ok: true, data: {} };
    },
  });

  const data = expectOkData(response);
  expect(invoked.map((req) => [req.command, req.positionals])).toEqual([['open', ['demo.app']]]);
  expect(data.passed).toBe(1);
  expect(data.failed).toBe(0);
});

test('test emits progress when attempts retry and pass', async () => {
  const sessionStore = makeSessionStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-suite-progress-'));
  fs.writeFileSync(path.join(root, '01-progress.ad'), 'context platform=ios\nopen "Demo"\n');

  const events: RequestProgressEvent[] = [];
  let attempts = 0;
  const response = await withRequestProgressSink(
    (event) => events.push(event),
    async () =>
      await handleSessionCommands({
        req: {
          token: 't',
          session: 'default',
          command: 'test',
          positionals: [root],
          meta: { cwd: root, requestId: 'suite-progress' },
          flags: { retries: 1 },
        },
        sessionName: 'default',
        logPath: path.join(os.tmpdir(), 'daemon.log'),
        sessionStore,
        invoke: async () => {
          attempts += 1;
          if (attempts === 1) {
            return {
              ok: false,
              error: { code: 'COMMAND_FAILED', message: 'first attempt failed' },
            };
          }
          return { ok: true, data: { replayed: 1, healed: 0 } };
        },
      }),
  );

  const data = expectOkData(response);
  expect(data.passed).toBe(1);
  expect(events.map((event) => event.status)).toEqual(['fail', 'pass']);
  expect(events[0]).toMatchObject({
    type: 'replay-test',
    status: 'fail',
    index: 1,
    total: 1,
    attempt: 1,
    maxAttempts: 2,
    retrying: true,
    message: 'Replay failed at step 1 (open "Demo"): first attempt failed',
  });
  expect(events[1]).toMatchObject({
    type: 'replay-test',
    status: 'pass',
    index: 1,
    total: 1,
    attempt: 2,
    maxAttempts: 2,
  });
});

test('test emits skip progress without synthetic duration', async () => {
  const sessionStore = makeSessionStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-test-suite-skip-progress-'));
  fs.writeFileSync(path.join(root, '01-missing-platform.ad'), 'open "Demo"\n');
  fs.writeFileSync(path.join(root, '02-android.ad'), 'context platform=android\nopen "Demo"\n');

  const events: RequestProgressEvent[] = [];
  const response = await withRequestProgressSink(
    (event) => events.push(event),
    async () =>
      await handleSessionCommands({
        req: {
          token: 't',
          session: 'default',
          command: 'test',
          positionals: [root],
          meta: { cwd: root, requestId: 'suite-skip-progress' },
          flags: { platform: 'android' },
        },
        sessionName: 'default',
        logPath: path.join(os.tmpdir(), 'daemon.log'),
        sessionStore,
        invoke: async () => ({ ok: true, data: { replayed: 1, healed: 0 } }),
      }),
  );

  const data = expectOkData(response);
  expect(data.skipped).toBe(1);
  expect(events.map((event) => event.status)).toEqual(['skip', 'pass']);
  expect(events[0]).toMatchObject({
    type: 'replay-test',
    status: 'skip',
    index: 1,
    total: 2,
    message: 'missing platform metadata for --platform android',
  });
  expect(events[0]?.durationMs).toBeUndefined();
});
