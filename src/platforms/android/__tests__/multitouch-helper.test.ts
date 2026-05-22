import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test } from 'vitest';
import { ANDROID_EMULATOR } from '../../../__tests__/test-utils/index.ts';
import {
  ensureAndroidMultiTouchHelper,
  parseAndroidMultiTouchHelperOutput,
  pinchAndroid,
  resetAndroidMultiTouchHelperInstallCache,
  rotateGestureAndroid,
  runAndroidMultiTouchHelperGesture,
  transformGestureAndroid,
} from '../multitouch-helper.ts';
import {
  withAndroidAdbProvider,
  type AndroidAdbExecutor,
  type AndroidAdbProvider,
} from '../adb-executor.ts';

const manifest = {
  name: 'android-multitouch-helper' as const,
  version: '0.15.0',
  assetName: 'helper.apk',
  sha256: 'a'.repeat(64),
  packageName: 'com.callstack.agentdevice.multitouchhelper',
  versionCode: 15000,
  instrumentationRunner: 'com.callstack.agentdevice.multitouchhelper/.MultiTouchInstrumentation',
  statusProtocol: 'android-multitouch-helper-v1' as const,
};

beforeEach(() => {
  resetAndroidMultiTouchHelperInstallCache();
});

test('parseAndroidMultiTouchHelperOutput returns final instrumentation gesture metadata', () => {
  const parsed = parseAndroidMultiTouchHelperOutput(
    [
      resultRecord({
        ok: 'true',
        kind: 'pinch',
        helperApiVersion: '1',
        injectedEvents: '24',
        elapsedMs: '315',
      }),
      'INSTRUMENTATION_CODE: 0',
    ].join('\n'),
  );

  assert.deepEqual(parsed, {
    kind: 'pinch',
    helperApiVersion: '1',
    injectedEvents: 24,
    elapsedMs: 315,
  });
});

test('runAndroidMultiTouchHelperGesture encodes protocol payload for instrumentation', async () => {
  let capturedArgs: string[] | undefined;
  const result = await runAndroidMultiTouchHelperGesture({
    adb: async (args) => {
      capturedArgs = args;
      return {
        exitCode: 0,
        stdout: [resultRecord({ ok: 'true', kind: 'rotate' }), 'INSTRUMENTATION_CODE: 0'].join(
          '\n',
        ),
        stderr: '',
      };
    },
    request: { kind: 'rotate', x: 100, y: 200, degrees: 145, radius: 120, durationMs: 250 },
    packageName: manifest.packageName,
    instrumentationRunner: manifest.instrumentationRunner,
  });

  assert.equal(result.kind, 'rotate');
  assert.ok(capturedArgs);
  assert.deepEqual(capturedArgs.slice(0, 7), [
    'shell',
    'am',
    'instrument',
    '-w',
    '-e',
    'payloadBase64',
    capturedArgs[6],
  ]);
  assert.deepEqual(JSON.parse(Buffer.from(capturedArgs[6]!, 'base64').toString('utf8')), {
    protocol: 'android-multitouch-helper-v1',
    kind: 'rotate',
    x: 100,
    y: 200,
    degrees: 145,
    radius: 120,
    durationMs: 250,
  });
  assert.equal(capturedArgs.at(-1), manifest.instrumentationRunner);
});

test('pinchAndroid, rotateGestureAndroid, and transformGestureAndroid prefer provider-native touch injection', async () => {
  const calls: unknown[] = [];
  await withAndroidAdbProvider(
    {
      exec: async () => {
        throw new Error('adb should not run when native touch is available');
      },
      touch: async (request) => {
        calls.push(request);
        return { backendDetail: 'native' };
      },
    },
    { serial: ANDROID_EMULATOR.id },
    async () => {
      const pinch = await pinchAndroid(ANDROID_EMULATOR, { scale: 2, x: 100, y: 200 });
      const rotate = await rotateGestureAndroid(ANDROID_EMULATOR, {
        degrees: -215,
        x: 100,
        y: 200,
      });
      const transform = await transformGestureAndroid(ANDROID_EMULATOR, {
        x: 100,
        y: 200,
        dx: 30,
        dy: -20,
        scale: 1.5,
        degrees: 35,
      });

      assert.equal(pinch.backend, 'provider-native-touch');
      assert.equal(rotate.backend, 'provider-native-touch');
      assert.equal(transform.backend, 'provider-native-touch');
    },
  );

  assert.deepEqual(calls, [
    { kind: 'pinch', x: 100, y: 200, scale: 2, durationMs: undefined },
    { kind: 'rotate', x: 100, y: 200, degrees: -215, durationMs: undefined },
    {
      kind: 'transform',
      x: 100,
      y: 200,
      dx: 30,
      dy: -20,
      scale: 1.5,
      degrees: 35,
      durationMs: undefined,
    },
  ]);
});

test('rotateGestureAndroid rejects zero velocity before provider dispatch', async () => {
  await withAndroidAdbProvider(
    {
      exec: async () => {
        throw new Error('adb should not run for invalid input');
      },
      touch: async () => {
        throw new Error('native touch should not run for invalid input');
      },
    },
    { serial: ANDROID_EMULATOR.id },
    async () => {
      await assert.rejects(
        () => rotateGestureAndroid(ANDROID_EMULATOR, { degrees: 90, velocity: 0 }),
        { code: 'INVALID_ARGS' },
      );
    },
  );
});

test('ensureAndroidMultiTouchHelper installs with semantic provider install options', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multitouch-helper-install-'));
  const apkPath = path.join(tmpDir, 'helper.apk');
  await fs.writeFile(apkPath, 'helper-apk');
  const installCalls: Array<{
    apkPath: string;
    replace?: boolean;
    allowTestPackages?: boolean;
  }> = [];
  const adb: AndroidAdbExecutor = async (args) => {
    if (args.includes('--show-versioncode')) {
      return { exitCode: 1, stdout: '', stderr: 'not found' };
    }
    throw new Error(`unexpected adb call: ${args.join(' ')}`);
  };
  const adbProvider: AndroidAdbProvider = {
    exec: adb,
    install: async (path, options) => {
      installCalls.push({
        apkPath: path,
        replace: options?.replace,
        allowTestPackages: options?.allowTestPackages,
      });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };

  const result = await ensureAndroidMultiTouchHelper({
    adb,
    adbProvider,
    artifact: { apkPath, manifest: { ...manifest, sha256: sha256Text('helper-apk') } },
    deviceKey: 'android:emulator-5554',
  });

  assert.equal(result.installed, true);
  assert.equal(result.reason, 'missing');
  assert.deepEqual(installCalls, [{ apkPath, replace: true, allowTestPackages: true }]);
});

function resultRecord(values: Record<string, string>): string {
  return [
    'INSTRUMENTATION_RESULT: agentDeviceProtocol=android-multitouch-helper-v1',
    ...Object.entries(values).map(([key, value]) => `INSTRUMENTATION_RESULT: ${key}=${value}`),
  ].join('\n');
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
