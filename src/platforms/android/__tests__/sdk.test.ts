import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureAndroidSdkPathConfigured,
  resolveAndroidSdkRoots,
  resolveAndroidToolPath,
} from '../sdk.ts';

async function withTempSdkLayout(
  run: (ctx: { env: NodeJS.ProcessEnv; sdkRoot: string }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-sdk-'));
  const sdkRoot = path.join(tmpDir, 'Android', 'Sdk');
  const cmdlineToolsLatestDir = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin');
  const cmdlineToolsToolsDir = path.join(sdkRoot, 'cmdline-tools', 'tools', 'bin');
  const emulatorDir = path.join(sdkRoot, 'emulator');
  const platformToolsDir = path.join(sdkRoot, 'platform-tools');

  await fs.mkdir(cmdlineToolsLatestDir, { recursive: true });
  await fs.mkdir(cmdlineToolsToolsDir, { recursive: true });
  await fs.mkdir(emulatorDir, { recursive: true });
  await fs.mkdir(platformToolsDir, { recursive: true });

  for (const filePath of [
    path.join(platformToolsDir, 'adb'),
    path.join(emulatorDir, 'emulator'),
    path.join(cmdlineToolsLatestDir, 'sdkmanager'),
    path.join(cmdlineToolsToolsDir, 'avdmanager'),
  ]) {
    await fs.writeFile(filePath, '#!/bin/sh\nexit 0\n', 'utf8');
    await fs.chmod(filePath, 0o755);
  }

  const env = {
    HOME: tmpDir,
    PATH: '',
  } satisfies NodeJS.ProcessEnv;

  try {
    await run({ env, sdkRoot });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('resolveAndroidSdkRoots prefers configured roots before HOME default', () => {
  const roots = resolveAndroidSdkRoots({
    HOME: '/tmp/home',
    ANDROID_HOME: '/tmp/android-home',
    ANDROID_SDK_ROOT: '/tmp/android-sdk-root',
  });
  assert.deepEqual(roots, [
    '/tmp/android-sdk-root',
    '/tmp/android-home',
    path.join('/tmp/home', 'Android', 'Sdk'),
  ]);
});

test('resolveAndroidToolPath finds tools in standard SDK subpaths', async () => {
  await withTempSdkLayout(async ({ env, sdkRoot }) => {
    env.ANDROID_SDK_ROOT = sdkRoot;

    assert.equal(
      await resolveAndroidToolPath('adb', env),
      path.join(sdkRoot, 'platform-tools', 'adb'),
    );
    assert.equal(
      await resolveAndroidToolPath('emulator', env),
      path.join(sdkRoot, 'emulator', 'emulator'),
    );
    assert.equal(
      await resolveAndroidToolPath('sdkmanager', env),
      path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'),
    );
    assert.equal(
      await resolveAndroidToolPath('avdmanager', env),
      path.join(sdkRoot, 'cmdline-tools', 'tools', 'bin', 'avdmanager'),
    );
  });
});

test('resolveAndroidToolPath falls back to PATH when SDK roots do not contain the tool', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-sdk-path-'));
  const adbDir = path.join(tmpDir, 'bin');
  const adbPath = path.join(adbDir, 'adb');
  await fs.mkdir(adbDir, { recursive: true });
  await fs.writeFile(adbPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(adbPath, 0o755);

  try {
    const env = {
      HOME: tmpDir,
      PATH: adbDir,
    } satisfies NodeJS.ProcessEnv;
    assert.equal(await resolveAndroidToolPath('adb', env), 'adb');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('ensureAndroidSdkPathConfigured mirrors a single configured SDK root into PATH and ANDROID_HOME', async () => {
  await withTempSdkLayout(async ({ env, sdkRoot }) => {
    env.ANDROID_SDK_ROOT = sdkRoot;

    await ensureAndroidSdkPathConfigured(env);

    assert.equal(env.ANDROID_HOME, sdkRoot);
    assert.equal(env.ANDROID_SDK_ROOT, sdkRoot);
    const pathEntries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
    assert.deepEqual(pathEntries.slice(0, 4), [
      path.join(sdkRoot, 'emulator'),
      path.join(sdkRoot, 'platform-tools'),
      path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin'),
      path.join(sdkRoot, 'cmdline-tools', 'tools', 'bin'),
    ]);
  });
});
