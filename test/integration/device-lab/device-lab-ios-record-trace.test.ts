import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { assertFlatToolCallStartsWith } from './assertions.ts';
import { DEVICE_LAB_IOS_DEVICE } from './fixtures.ts';
import { createDeviceLabHarness } from './harness.ts';
import {
  createAppleRunnerProviderFromTranscript,
  createRecordingAppleToolProvider,
} from './providers.ts';
import { createProviderTranscript } from './transcript.ts';

test('Device Lab iOS physical recording flow uses runner and devicectl providers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-lab-ios-record-'));
  const tracePath = path.join(tmpDir, 'trace.adtrace');
  const finalTracePath = path.join(tmpDir, 'trace-final.adtrace');
  const recordingPath = path.join(tmpDir, 'recording.mp4');
  const runnerTranscript = createProviderTranscript([
    {
      command: 'ios.runner.recordStart',
      deviceId: DEVICE_LAB_IOS_DEVICE.id,
      platform: 'ios',
      result: {},
    },
    {
      command: 'ios.runner.recordStop',
      deviceId: DEVICE_LAB_IOS_DEVICE.id,
      platform: 'ios',
      request: { command: 'recordStop', appBundleId: 'com.apple.Preferences' },
      result: {},
    },
  ]);
  const appleRunnerProvider = createAppleRunnerProviderFromTranscript(
    runnerTranscript,
    'ios.runner',
  );
  const appleTool = createRecordingAppleToolProvider(async (_cmd, args) => {
    writeJsonOutputIfRequested(args);
    writeCopiedRecordingIfRequested(args);
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  const daemon = await createDeviceLabHarness({
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_IOS_DEVICE],
  });

  try {
    const open = await daemon.callCommand('open', ['com.apple.Preferences'], {
      platform: 'ios',
      udid: DEVICE_LAB_IOS_DEVICE.id,
    });
    assert.equal(open.statusCode, 200, JSON.stringify(open.json));
    assert.equal(open.json?.result?.data?.device_udid, DEVICE_LAB_IOS_DEVICE.id);

    const traceStart = await daemon.callCommand('trace', ['start', tracePath]);
    assert.equal(traceStart.statusCode, 200, JSON.stringify(traceStart.json));
    assert.equal(traceStart.json?.result?.data?.trace, 'started');

    const recordStart = await daemon.callCommand('record', ['start', recordingPath], {
      fps: 30,
      quality: 8,
      hideTouches: true,
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

    const traceStop = await daemon.callCommand('trace', ['stop', finalTracePath]);
    assert.equal(traceStop.statusCode, 200, JSON.stringify(traceStop.json));
    assert.equal(traceStop.json?.result?.data?.trace, 'stopped');
    assert.equal(traceStop.json?.result?.data?.outPath, finalTracePath);

    runnerTranscript.assertComplete();
    const recordStartCall = runnerTranscript.calls.find(
      (call) => call.command === 'ios.runner.recordStart',
    );
    assert.deepEqual(
      {
        command: (recordStartCall?.request as { command?: unknown } | undefined)?.command,
        fps: (recordStartCall?.request as { fps?: unknown } | undefined)?.fps,
        quality: (recordStartCall?.request as { quality?: unknown } | undefined)?.quality,
        appBundleId: (recordStartCall?.request as { appBundleId?: unknown } | undefined)
          ?.appBundleId,
      },
      {
        command: 'recordStart',
        fps: 30,
        quality: 8,
        appBundleId: 'com.apple.Preferences',
      },
    );
    assert.match(
      String((recordStartCall?.request as { outPath?: unknown } | undefined)?.outPath),
      /^agent-device-recording-\d+\.mp4$/,
    );
    assert.equal(fs.existsSync(recordingPath), true);
    assert.equal(fs.existsSync(finalTracePath), true);
    assertFlatToolCallStartsWith(appleTool.calls, [
      'xcrun',
      'devicectl',
      'device',
      'info',
      'details',
      '--device',
      DEVICE_LAB_IOS_DEVICE.id,
    ]);
    assertFlatToolCallStartsWith(appleTool.calls, [
      'xcrun',
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      DEVICE_LAB_IOS_DEVICE.id,
      'com.apple.Preferences',
    ]);
    assertFlatToolCallStartsWith(appleTool.calls, [
      'xcrun',
      'devicectl',
      'device',
      'copy',
      'from',
      '--device',
      DEVICE_LAB_IOS_DEVICE.id,
    ]);
  } finally {
    await daemon.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeJsonOutputIfRequested(args: string[]): void {
  const jsonOutputIndex = args.indexOf('--json-output');
  const jsonPath = jsonOutputIndex >= 0 ? args[jsonOutputIndex + 1] : undefined;
  if (!jsonPath) return;
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      result: {
        device: { connectionProperties: { tunnelState: 'connected' } },
      },
    }),
    'utf8',
  );
}

function writeCopiedRecordingIfRequested(args: string[]): void {
  const destinationIndex = args.indexOf('--destination');
  const destination = destinationIndex >= 0 ? args[destinationIndex + 1] : undefined;
  if (!destination) return;
  fs.writeFileSync(destination, 'device-lab-recording');
}
