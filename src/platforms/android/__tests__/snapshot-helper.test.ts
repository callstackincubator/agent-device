import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  captureAndroidSnapshotWithHelper,
  ensureAndroidSnapshotHelper,
  parseAndroidSnapshotHelperManifest,
  parseAndroidSnapshotHelperOutput,
  parseAndroidSnapshotHelperSnapshot,
  parseAndroidSnapshotHelperXml,
  prepareAndroidSnapshotHelperArtifactFromManifestUrl,
  verifyAndroidSnapshotHelperArtifact,
  type AndroidAdbExecutor,
  type AndroidSnapshotHelperManifest,
} from '../snapshot-helper.ts';

const manifest: AndroidSnapshotHelperManifest = {
  name: 'android-snapshot-helper',
  version: '0.13.3',
  apkUrl: null,
  sha256: 'a'.repeat(64),
  packageName: 'com.callstack.agentdevice.snapshothelper',
  versionCode: 13003,
  instrumentationRunner: 'com.callstack.agentdevice.snapshothelper/.SnapshotInstrumentation',
  minSdk: 23,
  targetSdk: 36,
  outputFormat: 'uiautomator-xml',
  statusProtocol: 'android-snapshot-helper-v1',
  installArgs: ['install', '-r', '-t'],
};

test('parseAndroidSnapshotHelperOutput reconstructs XML chunks and metadata', () => {
  const xml = '<?xml version="1.0"?><hierarchy><node text="first&#10;second" /></hierarchy>';
  const output = helperOutput({
    chunks: ['<?xml version="1.0"?><hierarchy>', '<node text="first&#10;second" /></hierarchy>'],
    result: {
      ok: 'true',
      helperApiVersion: '1',
      outputFormat: 'uiautomator-xml',
      waitForIdleTimeoutMs: '25',
      timeoutMs: '8000',
      maxDepth: '128',
      maxNodes: '5000',
      rootPresent: 'true',
      captureMode: 'interactive-windows',
      windowCount: '2',
      nodeCount: '1',
      truncated: 'false',
      elapsedMs: '42',
    },
  });

  const parsed = parseAndroidSnapshotHelperOutput(output);

  assert.equal(parsed.xml, xml);
  assert.deepEqual(parsed.metadata, {
    helperApiVersion: '1',
    outputFormat: 'uiautomator-xml',
    waitForIdleTimeoutMs: 25,
    timeoutMs: 8000,
    maxDepth: 128,
    maxNodes: 5000,
    rootPresent: true,
    captureMode: 'interactive-windows',
    windowCount: 2,
    nodeCount: 1,
    truncated: false,
    elapsedMs: 42,
  });
});

test('parseAndroidSnapshotHelperOutput decodes UTF-8 across byte chunk boundaries', () => {
  const xml = '<hierarchy><node text="Save 👍" /></hierarchy>';
  const bytes = Buffer.from(xml, 'utf8');
  const split = bytes.indexOf(0xf0) + 2;
  const output = [
    statusRecord({
      chunkIndex: '0',
      chunkCount: '2',
      payloadBase64: bytes.subarray(0, split).toString('base64'),
    }),
    statusRecord({
      chunkIndex: '1',
      chunkCount: '2',
      payloadBase64: bytes.subarray(split).toString('base64'),
    }),
    resultRecord({ ok: 'true', outputFormat: 'uiautomator-xml' }),
    'INSTRUMENTATION_CODE: 0',
  ].join('\n');

  const parsed = parseAndroidSnapshotHelperOutput(output);

  assert.equal(parsed.xml, xml);
});

test('parseAndroidSnapshotHelperSnapshot returns shaped nodes', () => {
  const output = helperOutput({
    chunks: [
      '<hierarchy><node text="Continue" class="android.widget.Button" bounds="[1,2][21,42]" clickable="true" /><node text="Keyboard suggestion" class="android.widget.TextView" bounds="[1,44][121,84]" /></hierarchy>',
    ],
    result: {
      ok: 'true',
      outputFormat: 'uiautomator-xml',
      captureMode: 'interactive-windows',
      windowCount: '2',
      nodeCount: '2',
    },
  });

  const parsed = parseAndroidSnapshotHelperSnapshot(output);

  assert.equal(parsed.nodes[0]?.label, 'Continue');
  assert.equal(parsed.nodes[0]?.hittable, true);
  assert.deepEqual(parsed.nodes[0]?.rect, { x: 1, y: 2, width: 20, height: 40 });
  assert.equal(parsed.nodes[1]?.label, 'Keyboard suggestion');
  assert.equal(parsed.metadata.captureMode, 'interactive-windows');
  assert.equal(parsed.metadata.windowCount, 2);
  assert.equal(parsed.metadata.nodeCount, 2);
});

test('parseAndroidSnapshotHelperXml returns shaped nodes from captured helper output', () => {
  const parsed = parseAndroidSnapshotHelperXml(
    '<hierarchy><node text="Login" bounds="[2,4][22,44]" clickable="true" /></hierarchy>',
    { outputFormat: 'uiautomator-xml', nodeCount: 1 },
  );

  assert.equal(parsed.nodes[0]?.label, 'Login');
  assert.equal(parsed.nodes[0]?.hittable, true);
  assert.equal(parsed.metadata.nodeCount, 1);
});

test('parseAndroidSnapshotHelperOutput rejects incomplete chunks', () => {
  const output = [
    statusRecord({ chunkIndex: '0', chunkCount: '2', payloadBase64: encodeChunk('<hierarchy>') }),
    resultRecord({ ok: 'true', outputFormat: 'uiautomator-xml' }),
    'INSTRUMENTATION_CODE: 0',
  ].join('\n');

  assert.throws(() => parseAndroidSnapshotHelperOutput(output), {
    message: 'Android snapshot helper returned incomplete XML chunks',
  });
});

test('parseAndroidSnapshotHelperOutput rejects duplicate chunks', () => {
  const output = [
    statusRecord({ chunkIndex: '0', chunkCount: '2', payloadBase64: encodeChunk('<hierarchy>') }),
    statusRecord({
      chunkIndex: '0',
      chunkCount: '2',
      payloadBase64: encodeChunk('</hierarchy>'),
    }),
    resultRecord({ ok: 'true', outputFormat: 'uiautomator-xml' }),
    'INSTRUMENTATION_CODE: 0',
  ].join('\n');

  assert.throws(() => parseAndroidSnapshotHelperOutput(output), {
    message: 'Android snapshot helper returned duplicate XML chunks',
  });
});

test('parseAndroidSnapshotHelperOutput falls back to error type for null helper messages', () => {
  const output = [
    statusRecord({ chunkIndex: '0', chunkCount: '1', payloadBase64: encodeChunk('<hierarchy />') }),
    resultRecord({
      ok: 'false',
      outputFormat: 'uiautomator-xml',
      errorType: 'java.lang.IllegalStateException',
      message: 'null',
    }),
    'INSTRUMENTATION_CODE: 1',
  ].join('\n');

  assert.throws(() => parseAndroidSnapshotHelperOutput(output), {
    message: 'java.lang.IllegalStateException',
  });
});

test('ensureAndroidSnapshotHelper installs when missing and skips current version', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-helper-install-'));
  const apkPath = path.join(tmpDir, 'helper.apk');
  await fs.writeFile(apkPath, 'helper-apk');
  const localManifest = {
    ...manifest,
    sha256: sha256Text('helper-apk'),
  };
  const calls: string[][] = [];
  const adb: AndroidAdbExecutor = async (args) => {
    calls.push(args);
    if (args.includes('--show-versioncode')) {
      return { exitCode: 1, stdout: '', stderr: 'not found' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  const installed = await ensureAndroidSnapshotHelper({
    adb,
    artifact: { apkPath, manifest: localManifest },
  });

  assert.equal(installed.installed, true);
  assert.equal(installed.reason, 'missing');
  assert.deepEqual(calls[1], ['install', '-r', '-t', apkPath]);

  const skipped = await ensureAndroidSnapshotHelper({
    adb: async () => ({
      exitCode: 0,
      stdout: 'package:com.callstack.agentdevice.snapshothelper versionCode:13003',
      stderr: '',
    }),
    artifact: { apkPath: '/tmp/helper.apk', manifest },
  });

  assert.equal(skipped.installed, false);
  assert.equal(skipped.reason, 'current');
});

test('verifyAndroidSnapshotHelperArtifact rejects checksum mismatch', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-helper-sha-'));
  const apkPath = path.join(tmpDir, 'helper.apk');
  await fs.writeFile(apkPath, 'actual');

  await assert.rejects(
    () =>
      verifyAndroidSnapshotHelperArtifact({
        apkPath,
        manifest: { ...manifest, sha256: sha256Text('expected') },
      }),
    { message: 'Android snapshot helper APK checksum mismatch' },
  );
});

test('ensureAndroidSnapshotHelper never policy does not probe device', async () => {
  let called = false;
  const result = await ensureAndroidSnapshotHelper({
    adb: async () => {
      called = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    artifact: { apkPath: '/tmp/helper.apk', manifest },
    installPolicy: 'never',
  });

  assert.equal(called, false);
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'skipped');
});

test('ensureAndroidSnapshotHelper uninstalls and retries when signatures differ', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-helper-reinstall-'));
  const apkPath = path.join(tmpDir, 'helper.apk');
  await fs.writeFile(apkPath, 'helper-apk');
  const calls: string[][] = [];
  let installAttempts = 0;

  const result = await ensureAndroidSnapshotHelper({
    adb: async (args) => {
      calls.push(args);
      if (args.includes('--show-versioncode')) {
        return {
          exitCode: 0,
          stdout: 'package:com.callstack.agentdevice.snapshothelper versionCode:1',
          stderr: '',
        };
      }
      if (args[0] === 'install') {
        installAttempts += 1;
        if (installAttempts === 1) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]',
          };
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    artifact: {
      apkPath,
      manifest: { ...manifest, sha256: sha256Text('helper-apk') },
    },
  });

  assert.equal(result.installed, true);
  assert.equal(result.reason, 'outdated');
  assert.deepEqual(calls[1], ['install', '-r', '-t', apkPath]);
  assert.deepEqual(calls[2], ['uninstall', 'com.callstack.agentdevice.snapshothelper']);
  assert.deepEqual(calls[3], ['install', '-r', '-t', apkPath]);
});

test('captureAndroidSnapshotWithHelper uses injected adb executor', async () => {
  let capturedArgs: string[] | undefined;
  const adb: AndroidAdbExecutor = async (args, options) => {
    capturedArgs = args;
    assert.equal(options?.allowFailure, true);
    assert.equal(options?.timeoutMs, 14000);
    return {
      exitCode: 0,
      stdout: helperOutput({
        chunks: ['<hierarchy><node index="0" /></hierarchy>'],
        result: {
          ok: 'true',
          outputFormat: 'uiautomator-xml',
          waitForIdleTimeoutMs: '10',
          timeoutMs: '9000',
          maxDepth: '64',
          maxNodes: '100',
        },
      }),
      stderr: '',
    };
  };

  const result = await captureAndroidSnapshotWithHelper({
    adb,
    waitForIdleTimeoutMs: 10,
    timeoutMs: 9000,
    maxDepth: 64,
    maxNodes: 100,
  });

  assert.deepEqual(capturedArgs, [
    'shell',
    'am',
    'instrument',
    '-w',
    '-e',
    'waitForIdleTimeoutMs',
    '10',
    '-e',
    'timeoutMs',
    '9000',
    '-e',
    'maxDepth',
    '64',
    '-e',
    'maxNodes',
    '100',
    'com.callstack.agentdevice.snapshothelper/.SnapshotInstrumentation',
  ]);
  assert.equal(result.xml, '<hierarchy><node index="0" /></hierarchy>');
  assert.equal(result.metadata.maxNodes, 100);
});

test('captureAndroidSnapshotWithHelper gives adb command overhead beyond helper timeout', async () => {
  let commandTimeoutMs: number | undefined;
  await captureAndroidSnapshotWithHelper({
    adb: async (_args, options) => {
      commandTimeoutMs = options?.timeoutMs;
      return {
        exitCode: 0,
        stdout: helperOutput({
          chunks: ['<hierarchy><node index="0" /></hierarchy>'],
          result: {
            ok: 'true',
            outputFormat: 'uiautomator-xml',
            timeoutMs: '8000',
          },
        }),
        stderr: '',
      };
    },
    timeoutMs: 8000,
  });

  assert.equal(commandTimeoutMs, 13000);
});

test('captureAndroidSnapshotWithHelper wraps unparseable failed output with adb details', async () => {
  await assert.rejects(
    () =>
      captureAndroidSnapshotWithHelper({
        adb: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'instrumentation failed',
        }),
      }),
    (error) => {
      assert.equal(
        (error as Error).message,
        'Android snapshot helper failed before returning parseable output',
      );
      assert.equal((error as { details?: Record<string, unknown> }).details?.exitCode, 1);
      assert.equal(
        (error as { details?: Record<string, unknown> }).details?.stderr,
        'instrumentation failed',
      );
      return true;
    },
  );
});

test('prepareAndroidSnapshotHelperArtifactFromManifestUrl downloads and verifies APK', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-helper-download-'));
  const apk = Buffer.from('downloaded-helper');
  const manifestUrl = 'https://example.test/helper.manifest.json';
  const apkUrl = 'https://example.test/helper.apk';
  const fetched: string[] = [];

  const artifact = await prepareAndroidSnapshotHelperArtifactFromManifestUrl({
    manifestUrl,
    cacheDir: tmpDir,
    fetch: async (url) => {
      fetched.push(String(url));
      if (url === manifestUrl) {
        return new Response(
          JSON.stringify({
            ...manifest,
            assetName: 'helper.apk',
            apkUrl,
            sha256: sha256Buffer(apk),
          }),
        );
      }
      if (url === apkUrl) {
        return new Response(apk);
      }
      return new Response('not found', { status: 404 });
    },
  });

  assert.deepEqual(fetched, [manifestUrl, apkUrl]);
  assert.equal(await fs.readFile(artifact.apkPath, 'utf8'), 'downloaded-helper');
  assert.equal(artifact.manifest.sha256, sha256Buffer(apk));
  await artifact.cleanup?.();
});

test('parseAndroidSnapshotHelperManifest validates manifest shape', () => {
  assert.throws(() => parseAndroidSnapshotHelperManifest({ ...manifest, outputFormat: 'json' }), {
    message: 'Android snapshot helper manifest outputFormat must be "uiautomator-xml".',
  });
  assert.throws(() => parseAndroidSnapshotHelperManifest({ ...manifest, installArgs: ['shell'] }), {
    message: 'Android snapshot helper manifest installArgs must start with "install".',
  });
  assert.throws(() => parseAndroidSnapshotHelperManifest({ ...manifest, sha256: 'not-a-sha' }), {
    message: 'Android snapshot helper manifest sha256 must be a 64-character hex string.',
  });
  assert.equal(
    parseAndroidSnapshotHelperManifest({
      ...manifest,
      sha256: ` ${sha256Text('helper-apk').toUpperCase()} `,
    }).sha256,
    sha256Text('helper-apk'),
  );
});

function helperOutput(options: { chunks: string[]; result: Record<string, string> }): string {
  return [
    ...options.chunks.map((payload, index) =>
      statusRecord({
        chunkIndex: String(index),
        chunkCount: String(options.chunks.length),
        payloadBase64: encodeChunk(payload),
      }),
    ),
    resultRecord(options.result),
    'INSTRUMENTATION_CODE: 0',
  ].join('\n');
}

function statusRecord(values: Record<string, string>): string {
  return [
    'INSTRUMENTATION_STATUS: agentDeviceProtocol=android-snapshot-helper-v1',
    'INSTRUMENTATION_STATUS: helperApiVersion=1',
    'INSTRUMENTATION_STATUS: outputFormat=uiautomator-xml',
    ...Object.entries(values).map(([key, value]) => `INSTRUMENTATION_STATUS: ${key}=${value}`),
    'INSTRUMENTATION_STATUS_CODE: 1',
  ].join('\n');
}

function encodeChunk(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function resultRecord(values: Record<string, string>): string {
  return [
    'INSTRUMENTATION_RESULT: agentDeviceProtocol=android-snapshot-helper-v1',
    'INSTRUMENTATION_RESULT: helperApiVersion=1',
    ...Object.entries(values).map(([key, value]) => `INSTRUMENTATION_RESULT: ${key}=${value}`),
  ].join('\n');
}

function sha256Text(value: string): string {
  return sha256Buffer(Buffer.from(value));
}

function sha256Buffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
