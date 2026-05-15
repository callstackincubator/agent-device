import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import type { AndroidAdbProvider } from '../../../src/platforms/android/adb-executor.ts';
import { assertCommandCall } from './assertions.ts';
import { DEVICE_LAB_ANDROID } from './fixtures.ts';
import { restoreEnv, startDeviceLabDaemon } from './http-harness.ts';

test('Device Lab Android recording flow uses scripted ADB provider pull capability', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-lab-android-record-'));
  const recordingPath = path.join(tmpDir, 'recording.mp4');
  const adbCalls: string[][] = [];
  const pullCalls: Array<{ remotePath: string; localPath: string }> = [];
  const adbProvider: AndroidAdbProvider = {
    exec: async (args) => {
      adbCalls.push([...args]);
      return androidAdbResult(args);
    },
    pull: async (remotePath, localPath) => {
      pullCalls.push({ remotePath, localPath });
      fs.writeFileSync(localPath, likelyPlayableMp4Container());
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
  const daemon = await startDeviceLabDaemon({
    androidAdbProvider: () => adbProvider,
    deviceInventoryProvider: async () => [DEVICE_LAB_ANDROID],
  });

  const previousPath = process.env.PATH;
  const swiftPath = path.join(tmpDir, 'swift');
  fs.writeFileSync(swiftPath, '#!/bin/sh\nexit 0\n', 'utf8');
  fs.chmodSync(swiftPath, 0o755);
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  try {
    const open = await daemon.callCommand('open', ['settings'], {
      platform: 'android',
      serial: DEVICE_LAB_ANDROID.id,
    });
    assert.equal(open.statusCode, 200, JSON.stringify(open.json));

    const recordStart = await daemon.callCommand('record', ['start', recordingPath], {
      hideTouches: true,
      quality: 7,
    });
    assert.equal(recordStart.statusCode, 200, JSON.stringify(recordStart.json));
    assert.equal(recordStart.json?.result?.data?.recording, 'started');
    assert.equal(recordStart.json?.result?.data?.showTouches, false);

    const recordStop = await daemon.callCommand('record', ['stop']);
    assert.equal(recordStop.statusCode, 200, JSON.stringify(recordStop.json));
    assert.equal(recordStop.json?.result?.data?.recording, 'stopped');
    assert.equal(recordStop.json?.result?.data?.outPath, recordingPath);
    assert.equal(recordStop.json?.result?.data?.showTouches, false);
    assert.equal(recordStop.json?.result?.data?.artifacts?.[0]?.path, recordingPath);
    assert.equal(fs.existsSync(recordingPath), true);

    assertCommandCall(adbCalls, ['shell', 'wm', 'size']);
    assert.ok(
      adbCalls.some((args) =>
        /^shell screenrecord --size 756x1344 \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
          args.join(' '),
        ),
      ),
      JSON.stringify(adbCalls),
    );
    assertCommandCall(adbCalls, ['shell', 'kill', '-2', '4321']);
    assert.equal(pullCalls.length, 1);
    assert.match(pullCalls[0]?.remotePath ?? '', /^\/sdcard\/agent-device-recording-\d+\.mp4$/);
    assert.equal(pullCalls[0]?.localPath, recordingPath);
    assert.ok(adbCalls.some((args) => args[0] === 'shell' && args[1] === 'rm'));
    assert.equal(
      adbCalls.some((args) => args[0] === 'pull'),
      false,
    );
  } finally {
    await daemon.close();
    restoreEnv('PATH', previousPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function androidAdbResult(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutBuffer?: Buffer;
} {
  const command = args.join(' ');
  if (command === 'shell getprop sys.boot_completed') {
    return { stdout: '1\n', stderr: '', exitCode: 0 };
  }
  if (command === 'shell wm size') {
    return { stdout: 'Physical size: 1080x1920\n', stderr: '', exitCode: 0 };
  }
  if (
    /^shell screenrecord --size 756x1344 \/sdcard\/agent-device-recording-\d+\.mp4 >\/dev\/null 2>&1 & echo \$!$/.test(
      command,
    )
  ) {
    return { stdout: '4321\n', stderr: '', exitCode: 0 };
  }
  if (/^shell stat -c %s \/sdcard\/agent-device-recording-\d+\.mp4$/.test(command)) {
    return { stdout: '2048\n', stderr: '', exitCode: 0 };
  }
  if (command === 'shell ps -o pid= -p 4321') {
    return { stdout: '', stderr: '', exitCode: 1 };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

function likelyPlayableMp4Container(): Buffer {
  return Buffer.concat([atom('ftyp', Buffer.from('isom0000isom')), atom('moov', Buffer.from(''))]);
}

function atom(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, payload]);
}
