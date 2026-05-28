import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, DaemonResponseData } from '../../types.ts';

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
