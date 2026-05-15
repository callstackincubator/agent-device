import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { assertRpcOk } from './assertions.ts';
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
    assert.equal(assertRpcOk(open).appBundleId, 'com.apple.systempreferences');

    const recordStart = await daemon.callCommand('record', ['start', recordingPath], {
      hideTouches: true,
    });
    const recordStartData = assertRpcOk(recordStart);
    assert.equal(recordStartData.recording, 'started');
    assert.equal(recordStartData.outPath, recordingPath);
    assert.equal(recordStartData.showTouches, false);

    const recordStop = await daemon.callCommand('record', ['stop']);
    const recordStopData = assertRpcOk<{
      recording?: unknown;
      outPath?: unknown;
      showTouches?: unknown;
      artifacts?: Array<{ path?: unknown }>;
    }>(recordStop);
    assert.equal(recordStopData.recording, 'stopped');
    assert.equal(recordStopData.outPath, recordingPath);
    assert.equal(recordStopData.showTouches, false);
    assert.equal(recordStopData.artifacts?.[0]?.path, recordingPath);

    runnerTranscript.assertComplete();
  } finally {
    await close();
  }
});
