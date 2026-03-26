import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
