import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';

function makeSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone',
      kind: 'simulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
}

function isSessionScriptFile(file: string): boolean {
  return file.endsWith('.ad');
}

function listSessionScriptFiles(root: string): string[] {
  return fs.readdirSync(root).filter(isSessionScriptFile);
}

function readWrittenSessionScript(root: string): string {
  const scriptFile = fs.readdirSync(root).find(isSessionScriptFile);
  assert.ok(scriptFile);
  return fs.readFileSync(path.join(root, scriptFile), 'utf8');
}

test('expandHome resolves tilde, relative-with-cwd, and absolute paths', () => {
  const homePath = SessionStore.expandHome('~/flows/replay.ad');
  assert.equal(homePath.startsWith(os.homedir()), true);
  assert.equal(homePath.endsWith(path.join('flows', 'replay.ad')), true);

  const relativePath = SessionStore.expandHome('workflows/replay.ad', '/tmp/agent-device-cwd');
  assert.equal(relativePath, path.resolve('/tmp/agent-device-cwd', 'workflows/replay.ad'));

  const absoluteInput = path.resolve('/tmp', 'agent-device-absolute.ad');
  const absolutePath = SessionStore.expandHome(absoluteInput, '/tmp/ignored-cwd');
  assert.equal(absolutePath, absoluteInput);
});

test('recordAction stores normalized action entries', () => {
  const store = new SessionStore(path.join(os.tmpdir(), 'agent-device-tests'));
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'snapshot',
    positionals: [],
    flags: { platform: 'ios', snapshotInteractiveOnly: true, verbose: true },
    result: { nodes: 1 },
  });
  assert.equal(session.actions.length, 1);
  assert.equal(session.actions[0].command, 'snapshot');
  assert.equal(session.actions[0].flags.platform, 'ios');
  assert.equal(session.actions[0].flags.snapshotInteractiveOnly, true);
});

test('recordAction skips entries marked noRecord', () => {
  const store = new SessionStore(path.join(os.tmpdir(), 'agent-device-tests'));
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'click',
    positionals: ['@e1'],
    flags: { noRecord: true },
    result: {},
  });
  assert.equal(session.actions.length, 0);
});

test('defaultTracePath sanitizes session name', () => {
  const store = new SessionStore(path.join(os.tmpdir(), 'agent-device-tests'));
  const session = makeSession('session with spaces');
  const tracePath = store.defaultTracePath(session);
  assert.match(tracePath, /session_with_spaces/);
  assert.match(tracePath, /\.trace\.log$/);
});

test('writeSessionLog writes .ad only when recording is enabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-disabled-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  assert.equal(listSessionScriptFiles(root).length, 0);
});

test('saveScript flag enables .ad session log writing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-enabled-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  assert.equal(listSessionScriptFiles(root).length, 1);
});

test('saveScript path writes session log to custom location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-custom-path-'));
  const store = new SessionStore(path.join(root, 'sessions'));
  const session = makeSession('default');
  const customPath = path.join(root, 'workflows', 'my-flow.ad');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: customPath },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  assert.equal(fs.existsSync(customPath), true);
  assert.equal(fs.existsSync(path.join(root, 'sessions')), false);
});

test('writeSessionLog persists open --relaunch in script output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-relaunch-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true, relaunch: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(script, /open "Settings" --relaunch/);
});

test('writeSessionLog persists record --hide-touches flags in script output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-record-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'record',
    positionals: ['start', './capture.mp4'],
    flags: { platform: 'ios', fps: 30, quality: 8, hideTouches: true },
    result: { action: 'start', showTouches: false },
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(script, /record start "\.\/capture\.mp4" --fps 30 --quality 8 --hide-touches/);
});

test('writeSessionLog persists screenshot flags in script output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-screenshot-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'screenshot',
    positionals: ['./page.png'],
    flags: { platform: 'ios', screenshotFullscreen: true, screenshotMaxSize: 1024 },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(script, /screenshot "\.\/page\.png" --fullscreen --max-size 1024/);
});

test('writeSessionLog persists inline open runtime hints in script output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-open-runtime-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true, relaunch: true },
    runtime: {
      platform: 'ios',
      metroHost: '127.0.0.1',
      metroPort: 8081,
      launchUrl: 'myapp://dev',
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(
    script,
    /open "Settings" --relaunch --platform ios --metro-host 127\.0\.0\.1 --metro-port 8081 --launch-url myapp:\/\/dev/,
  );
});

test('writeSessionLog persists runtime set hints in script output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-runtime-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'runtime',
    positionals: ['set'],
    flags: {
      platform: 'ios',
      metroHost: '127.0.0.1',
      metroPort: 8081,
      launchUrl: 'myapp://dev',
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(
    script,
    /runtime set --platform ios --metro-host 127\.0\.0\.1 --metro-port 8081 --launch-url myapp:\/\/dev/,
  );
});

test('writeSessionLog preserves interaction series flags for click/press/swipe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-series-flags-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'click',
    positionals: ['id="continue_button"'],
    flags: {
      platform: 'ios',
      count: 5,
      intervalMs: 1,
      holdMs: 2,
      jitterPx: 3,
      doubleTap: true,
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'press',
    positionals: ['201', '545'],
    flags: {
      platform: 'ios',
      count: 4,
      intervalMs: 8,
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'swipe',
    positionals: ['10', '20', '30', '40'],
    flags: {
      platform: 'ios',
      count: 3,
      pauseMs: 12,
      pattern: 'ping-pong',
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'fill',
    positionals: ['@e5', 'search'],
    flags: {
      platform: 'ios',
      delayMs: 40,
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(
    script,
    /click "id=\\"continue_button\\"" --count 5 --interval-ms 1 --hold-ms 2 --jitter-px 3 --double-tap/,
  );
  assert.match(script, /press 201 545 --count 4 --interval-ms 8/);
  assert.match(script, /swipe 10 20 30 40 --count 3 --pause-ms 12 --pattern ping-pong/);
  assert.match(script, /fill @e5 "search" --delay-ms 40/);
});

test('writeSessionLog escapes device labels with quotes and backslashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-device-label-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  session.device.name = 'QA "Lab" \\ Shelf';
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(
    script,
    /context platform=ios device="QA \\"Lab\\" \\\\ Shelf" kind=simulator theme=unknown/,
  );
});

test('writeSessionLog preserves significant whitespace and empty string arguments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-whitespace-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    runtime: {
      platform: 'ios',
      metroHost: ' host\t',
      launchUrl: 'myapp://dev ',
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'type',
    positionals: ['  leading\ttrailing  '],
    flags: { platform: 'ios' },
    result: {},
  });
  store.recordAction(session, {
    command: 'fill',
    positionals: ['@e5', ''],
    flags: { platform: 'ios' },
    result: { refLabel: 'Search field' },
  });
  store.recordAction(session, {
    command: 'screenshot',
    positionals: [' ./screens/final.png '],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const script = readWrittenSessionScript(root);
  assert.match(script, /type "  leading\\ttrailing  "/);
  assert.match(script, /fill @e5 "Search field" ""/);
  assert.match(script, /screenshot " \.\/screens\/final\.png "/);
  assert.match(script, /--metro-host " host\\t" --launch-url "myapp:\/\/dev "/);
});
