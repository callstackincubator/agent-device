import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { DEVICE_LAB_MACOS } from './fixtures.ts';
import { createMacOsDesktopWorld } from './macos-world.ts';
import { createAppleRunnerProviderFromTranscript } from './providers.ts';
import { createProviderTranscript } from './transcript.ts';

test('Device Lab macOS recording flow uses runner provider through daemon path', async () => {
  const recordingPath = path.join(os.tmpdir(), `agent-device-lab-macos-record-${Date.now()}.mp4`);
  const runnerTranscript = createProviderTranscript([
    {
      command: 'macos.runner.recordStart',
      deviceId: DEVICE_LAB_MACOS.id,
      platform: 'macos',
      request: {
        command: 'recordStart',
        outPath: recordingPath,
        fps: undefined,
        quality: undefined,
        appBundleId: 'com.apple.systempreferences',
      },
      result: {},
    },
    {
      command: 'macos.runner.recordStop',
      deviceId: DEVICE_LAB_MACOS.id,
      platform: 'macos',
      request: { command: 'recordStop', appBundleId: 'com.apple.systempreferences' },
      result: {},
    },
  ]);
  const appleRunnerProvider = createAppleRunnerProviderFromTranscript(
    runnerTranscript,
    'macos.runner',
  );
  const { daemon, close } = await createMacOsDesktopWorld({ appleRunnerProvider });

  try {
    const open = await daemon.callCommand('open', ['settings'], { platform: 'macos' });
    assert.equal(open.statusCode, 200, JSON.stringify(open.json));
    assert.equal(open.json?.result?.data?.appBundleId, 'com.apple.systempreferences');

    const recordStart = await daemon.callCommand('record', ['start', recordingPath], {
      hideTouches: true,
    });
    assert.equal(recordStart.statusCode, 200, JSON.stringify(recordStart.json));
    assert.equal(recordStart.json?.result?.data?.recording, 'started');
    assert.equal(recordStart.json?.result?.data?.outPath, recordingPath);
    assert.equal(recordStart.json?.result?.data?.showTouches, false);

    const recordStop = await daemon.callCommand('record', ['stop']);
    assert.equal(recordStop.statusCode, 200, JSON.stringify(recordStop.json));
    assert.equal(recordStop.json?.result?.data?.recording, 'stopped');
    assert.equal(recordStop.json?.result?.data?.outPath, recordingPath);
    assert.equal(recordStop.json?.result?.data?.showTouches, false);
    assert.equal(recordStop.json?.result?.data?.artifacts?.[0]?.path, recordingPath);

    runnerTranscript.assertComplete();
  } finally {
    await close();
  }
});
