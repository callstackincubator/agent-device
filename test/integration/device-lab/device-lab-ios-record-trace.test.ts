import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import type { RecordingProvider } from '../../../src/daemon/recording-provider.ts';
import { assertFlatToolCallStartsWith } from './assertions.ts';
import { DEVICE_LAB_IOS_DEVICE, DEVICE_LAB_IOS_SIMULATOR } from './fixtures.ts';
import { createDeviceLabHarness, withDeviceLabTempDir } from './harness.ts';
import {
  createAppleRunnerProviderFromTranscript,
  createRecordingAppleToolProvider,
  simctlListDevicesJson,
} from './providers.ts';
import { createProviderTranscript } from './transcript.ts';

test('Device Lab iOS physical recording flow uses runner and devicectl providers', async () => {
  await withDeviceLabTempDir('agent-device-lab-ios-record-', async (tmpDir) => {
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
    const appleTool = createRecordingAppleToolProvider({
      devicectl: async (args) => {
        writeJsonOutputIfRequested(args);
        writeCopiedRecordingIfRequested(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
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
        'devicectl',
        'device',
        'info',
        'details',
        '--device',
        DEVICE_LAB_IOS_DEVICE.id,
      ]);
      assertFlatToolCallStartsWith(appleTool.calls, [
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        DEVICE_LAB_IOS_DEVICE.id,
        'com.apple.Preferences',
      ]);
      assertFlatToolCallStartsWith(appleTool.calls, [
        'devicectl',
        'device',
        'copy',
        'from',
        '--device',
        DEVICE_LAB_IOS_DEVICE.id,
      ]);
    } finally {
      await daemon.close();
    }
  });
});

test('Device Lab iOS simulator recording flow uses semantic recording provider', async () => {
  await withDeviceLabTempDir('agent-device-lab-ios-sim-record-', async (tmpDir) => {
    const recordingPath = path.join(tmpDir, 'sim-recording.mp4');
    const runnerTranscript = createProviderTranscript([
      {
        command: 'ios.runner.snapshot',
        deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
        platform: 'ios',
        request: {
          command: 'snapshot',
          appBundleId: 'com.apple.Preferences',
          interactiveOnly: true,
          compact: true,
          depth: 1,
        },
        result: { nodes: [], truncated: false },
      },
      {
        command: 'ios.runner.uptime',
        deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
        platform: 'ios',
        request: { command: 'uptime', appBundleId: 'com.apple.Preferences' },
        result: { currentUptimeMs: 12_345 },
      },
    ]);
    const appleRunnerProvider = createAppleRunnerProviderFromTranscript(
      runnerTranscript,
      'ios.runner',
    );
    const appleTool = createRecordingAppleToolProvider({
      simctl: async (args) => {
        if (args.join(' ') === 'list devices -j') {
          return simctlListDevicesJson('com.apple.CoreSimulator.SimRuntime.iOS-18-0', [
            { name: 'iPhone 15', udid: DEVICE_LAB_IOS_SIMULATOR.id },
          ]);
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });
    const recordingStarts: string[] = [];
    let stopped = false;
    const recordingProvider: RecordingProvider = {
      startIosSimulatorRecording: ({ device, outPath }) => {
        assert.equal(device.id, DEVICE_LAB_IOS_SIMULATOR.id);
        recordingStarts.push(outPath);
        fs.writeFileSync(outPath, 'device-lab-sim-recording', 'utf8');
        return {
          child: {
            kill: (signal) => {
              assert.equal(signal, 'SIGINT');
              stopped = true;
              return true;
            },
          },
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
    };
    const daemon = await createDeviceLabHarness({
      appleRunnerProvider: () => appleRunnerProvider,
      appleToolProvider: () => appleTool.provider,
      recordingProvider: () => recordingProvider,
      deviceInventoryProvider: async () => [DEVICE_LAB_IOS_SIMULATOR],
    });

    try {
      const open = await daemon.callCommand('open', ['com.apple.Preferences'], {
        platform: 'ios',
        udid: DEVICE_LAB_IOS_SIMULATOR.id,
      });
      assert.equal(open.statusCode, 200, JSON.stringify(open.json));
      assert.equal(open.json?.error, undefined, JSON.stringify(open.json));

      const recordStart = await daemon.callCommand('record', ['start', recordingPath], {
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

      runnerTranscript.assertComplete();
      assert.deepEqual(recordingStarts, [recordingPath]);
      assert.equal(stopped, true);
      assertFlatToolCallStartsWith(appleTool.calls, [
        'simctl',
        'launch',
        DEVICE_LAB_IOS_SIMULATOR.id,
        'com.apple.Preferences',
      ]);
      assert.equal(
        appleTool.calls.some((call) => call.includes('recordVideo')),
        false,
      );
    } finally {
      await daemon.close();
    }
  });
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
