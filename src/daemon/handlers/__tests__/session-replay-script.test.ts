import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../../utils/errors.ts';
import {
  parseReplayScript,
  readReplayScriptMetadata,
  writeReplayScript,
} from '../session-replay-script.ts';
import type { SessionAction, SessionState } from '../../types.ts';

function makeSession(): SessionState {
  return {
    name: 'default',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
}

test('writeReplayScript preserves inline open runtime hints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-script-open-'));
  const replayPath = path.join(root, 'flow.ad');
  const actions: SessionAction[] = [
    {
      ts: Date.now(),
      command: 'open',
      positionals: ['Demo'],
      runtime: {
        platform: 'android',
        metroHost: '10.0.0.10',
        metroPort: 8081,
        launchUrl: 'myapp://dev',
      },
      flags: { relaunch: true },
    },
  ];

  writeReplayScript(replayPath, actions, makeSession());
  const script = fs.readFileSync(replayPath, 'utf8');

  assert.match(
    script,
    /open "Demo" --relaunch --platform android --metro-host 10\.0\.0\.10 --metro-port 8081 --launch-url myapp:\/\/dev/,
  );
});

test('record replay script round-trips fps and hide-touches flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-script-record-'));
  const replayPath = path.join(root, 'flow.ad');
  const actions: SessionAction[] = [
    {
      ts: Date.now(),
      command: 'record',
      positionals: ['start', './capture.mp4'],
      flags: { fps: 24, hideTouches: true },
    },
  ];

  writeReplayScript(replayPath, actions, makeSession());
  const script = fs.readFileSync(replayPath, 'utf8');
  assert.match(script, /record start "\.\/capture\.mp4" --fps 24 --hide-touches/);

  const parsed = parseReplayScript(script);
  assert.deepEqual(parsed[0]?.positionals, ['start', './capture.mp4']);
  assert.equal(parsed[0]?.flags.fps, 24);
  assert.equal(parsed[0]?.flags.hideTouches, true);
});

test('screenshot replay script round-trips fullscreen flag', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-script-screenshot-'));
  const replayPath = path.join(root, 'flow.ad');
  const actions: SessionAction[] = [
    {
      ts: Date.now(),
      command: 'screenshot',
      positionals: ['./page.png'],
      flags: { screenshotFullscreen: true },
    },
  ];

  writeReplayScript(replayPath, actions, makeSession());
  const script = fs.readFileSync(replayPath, 'utf8');
  assert.match(script, /screenshot "\.\/page\.png" --fullscreen/);

  const parsed = parseReplayScript(script);
  assert.deepEqual(parsed[0]?.positionals, ['./page.png']);
  assert.equal(parsed[0]?.flags.screenshotFullscreen, true);
});

test('type and fill replay scripts round-trip typing delay flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-script-typing-'));
  const replayPath = path.join(root, 'flow.ad');
  const actions: SessionAction[] = [
    {
      ts: Date.now(),
      command: 'type',
      positionals: ['hello world'],
      flags: { delayMs: 75 },
    },
    {
      ts: Date.now(),
      command: 'fill',
      positionals: ['@e2', 'search'],
      flags: { delayMs: 40 },
    },
  ];

  writeReplayScript(replayPath, actions, makeSession());
  const script = fs.readFileSync(replayPath, 'utf8');
  assert.match(script, /type "hello world" --delay-ms 75/);
  assert.match(script, /fill @e2 "search" --delay-ms 40/);

  const parsed = parseReplayScript(script);
  assert.equal(parsed[0]?.flags.delayMs, 75);
  assert.equal(parsed[1]?.flags.delayMs, 40);
});

test('type replay script preserves literal delay flag tokens', () => {
  const parsed = parseReplayScript('type "--delay-ms" "abc"\n');
  assert.deepEqual(parsed[0]?.positionals, ['--delay-ms', 'abc']);
  assert.equal(parsed[0]?.flags.delayMs, undefined);
});

test('writeReplayScript escapes device labels with quotes and backslashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-script-device-label-'));
  const replayPath = path.join(root, 'flow.ad');
  const session = makeSession();
  session.device.name = 'Pixel "QA" \\ Lab';

  writeReplayScript(replayPath, [], session);
  const script = fs.readFileSync(replayPath, 'utf8');

  assert.match(
    script,
    /context platform=android device="Pixel \\"QA\\" \\\\ Lab" kind=emulator theme=unknown/,
  );
});

test('writeReplayScript preserves significant whitespace and empty string arguments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-script-whitespace-'));
  const replayPath = path.join(root, 'flow.ad');
  const actions: SessionAction[] = [
    {
      ts: Date.now(),
      command: 'type',
      positionals: ['  leading\ttrailing  '],
      flags: {},
    },
    {
      ts: Date.now(),
      command: 'fill',
      positionals: ['@e2', ''],
      flags: {},
    },
    {
      ts: Date.now(),
      command: 'screenshot',
      positionals: [' ./screens/final.png '],
      flags: {},
    },
    {
      ts: Date.now(),
      command: 'screenshot',
      positionals: ['foo\\nbar.png'],
      flags: {},
    },
    {
      ts: Date.now(),
      command: 'open',
      positionals: ['Demo'],
      runtime: {
        platform: 'android',
        metroHost: ' host\t',
        launchUrl: 'myapp://dev ',
      },
      flags: {},
    },
  ];

  writeReplayScript(replayPath, actions, makeSession());
  const script = fs.readFileSync(replayPath, 'utf8');

  assert.match(script, /type "  leading\\ttrailing  "/);
  assert.match(script, /fill @e2 ""/);
  assert.match(script, /screenshot " \.\/screens\/final\.png "/);
  assert.match(script, /screenshot "foo\\\\nbar\.png"/);
  assert.match(script, /--metro-host " host\\t" --launch-url "myapp:\/\/dev "/);
  const parsed = parseReplayScript(script);
  assert.deepEqual(parsed[0]?.positionals, ['  leading\ttrailing  ']);
  assert.deepEqual(parsed[1]?.positionals, ['@e2', '']);
  assert.deepEqual(parsed[2]?.positionals, [' ./screens/final.png ']);
  assert.deepEqual(parsed[3]?.positionals, ['foo\\nbar.png']);
  assert.deepEqual(parsed[4]?.runtime, {
    platform: 'android',
    metroHost: ' host\t',
    launchUrl: 'myapp://dev ',
  });
});

test('readReplayScriptMetadata extracts platform from context header', () => {
  const metadata = readReplayScriptMetadata(
    '# comment\n\ncontext platform=android device="Pixel 9 Pro"\nopen "Demo"\n',
  );

  assert.equal(metadata.platform, 'android');
});

test('readReplayScriptMetadata ignores non-concrete platform aliases', () => {
  const metadata = readReplayScriptMetadata(
    'context platform=apple device="Host Mac"\nopen "Demo"\n',
  );

  assert.equal(metadata.platform, undefined);
});

test('readReplayScriptMetadata extracts timeout and retries from context header', () => {
  const metadata = readReplayScriptMetadata(
    'context platform=ios timeout=45000\ncontext retries=2 device="iPhone 17"\nopen "Demo"\n',
  );

  assert.equal(metadata.platform, 'ios');
  assert.equal(metadata.timeoutMs, 45000);
  assert.equal(metadata.retries, 2);
});

test('readReplayScriptMetadata rejects duplicate metadata keys in context header', () => {
  assert.throws(
    () =>
      readReplayScriptMetadata(
        'context platform=ios timeout=45000\ncontext platform=ios retries=2\nopen "Demo"\n',
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Duplicate replay test metadata "platform"/.test(error.message),
  );
});

test('readReplayScriptMetadata rejects conflicting metadata keys in context header', () => {
  assert.throws(
    () =>
      readReplayScriptMetadata(
        'context platform=ios timeout=45000\ncontext retries=2 timeout=5000\nopen "Demo"\n',
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Conflicting replay test metadata "timeoutMs"/.test(error.message),
  );
});
