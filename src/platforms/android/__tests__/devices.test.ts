import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureAndroidEmulatorBooted,
  parseAndroidAvdList,
  parseAndroidFeatureListForTv,
  parseAndroidTargetFromCharacteristics,
  resolveAndroidAvdName,
} from '../devices.ts';

test('parseAndroidTargetFromCharacteristics detects tv markers', () => {
  assert.equal(parseAndroidTargetFromCharacteristics('tv,nosdcard'), 'tv');
  assert.equal(parseAndroidTargetFromCharacteristics('watch,leanback'), 'tv');
  assert.equal(parseAndroidTargetFromCharacteristics('phone,tablet'), null);
});

test('parseAndroidFeatureListForTv detects television and leanback features', () => {
  const tvFeatures = [
    'feature:android.software.leanback',
    'feature:android.hardware.type.television',
  ].join('\n');
  assert.equal(parseAndroidFeatureListForTv(tvFeatures), true);
  assert.equal(parseAndroidFeatureListForTv('feature:android.hardware.camera'), false);
});

test('parseAndroidAvdList drops empty lines', () => {
  const listed = parseAndroidAvdList('\nPixel_9_Pro_XL\n\nWear_OS\n');
  assert.deepEqual(listed, ['Pixel_9_Pro_XL', 'Wear_OS']);
});

test('resolveAndroidAvdName supports space vs underscore matching', () => {
  const avdNames = ['Pixel_9_Pro_XL', 'Medium_Tablet_API_35'];
  assert.equal(resolveAndroidAvdName(avdNames, 'Pixel_9_Pro_XL'), 'Pixel_9_Pro_XL');
  assert.equal(resolveAndroidAvdName(avdNames, 'pixel 9 pro xl'), 'Pixel_9_Pro_XL');
  assert.equal(resolveAndroidAvdName(avdNames, 'unknown'), undefined);
});

async function withMockedAndroidTools(
  run: (ctx: { emulatorLogPath: string; emulatorBootedPath: string }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-headless-'));
  const emulatorLogPath = path.join(tmpDir, 'emulator.log');
  const emulatorBootedPath = path.join(tmpDir, 'emulator.booted');
  const adbPath = path.join(tmpDir, 'adb');
  const emulatorPath = path.join(tmpDir, 'emulator');

  await fs.writeFile(
    adbPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "devices" ] && [ "$2" = "-l" ]; then',
      '  echo "List of devices attached"',
      '  if [ -f "$AGENT_DEVICE_TEST_EMU_BOOTED_FILE" ]; then',
      '    echo "emulator-5554 device product:sdk_gphone64 model:Pixel_9_Pro_XL device:emu64a transport_id:2"',
      '  fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "emu" ] && [ "$4" = "avd" ] && [ "$5" = "name" ]; then',
      '  echo "Pixel_9_Pro_XL"',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "shell" ] && [ "$4" = "getprop" ] && [ "$5" = "ro.boot.qemu.avd_name" ]; then',
      '  echo "Pixel_9_Pro_XL"',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "shell" ] && [ "$4" = "getprop" ] && [ "$5" = "persist.sys.avd_name" ]; then',
      '  echo "Pixel_9_Pro_XL"',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "shell" ] && [ "$4" = "getprop" ] && [ "$5" = "sys.boot_completed" ]; then',
      '  if [ -f "$AGENT_DEVICE_TEST_EMU_BOOTED_FILE" ]; then',
      '    echo "1"',
      '  else',
      '    echo "0"',
      '  fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "shell" ] && [ "$4" = "getprop" ] && [ "$5" = "ro.build.characteristics" ]; then',
      '  echo "phone"',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "shell" ] && [ "$4" = "cmd" ] && [ "$5" = "package" ] && [ "$6" = "has-feature" ]; then',
      '  echo "false"',
      '  exit 0',
      'fi',
      'if [ "$1" = "-s" ] && [ "$2" = "emulator-5554" ] && [ "$3" = "shell" ] && [ "$4" = "pm" ] && [ "$5" = "list" ] && [ "$6" = "features" ]; then',
      '  echo ""',
      '  exit 0',
      'fi',
      'echo "unexpected adb args: $@" >> "$AGENT_DEVICE_TEST_EMU_LOG_FILE"',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    emulatorPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "-list-avds" ]; then',
      '  echo "Pixel_9_Pro_XL"',
      '  exit 0',
      'fi',
      'if [ "$1" = "-avd" ]; then',
      '  echo "$@" >> "$AGENT_DEVICE_TEST_EMU_LOG_FILE"',
      '  touch "$AGENT_DEVICE_TEST_EMU_BOOTED_FILE"',
      '  exit 0',
      'fi',
      'echo "unexpected emulator args: $@" >> "$AGENT_DEVICE_TEST_EMU_LOG_FILE"',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);
  await fs.chmod(emulatorPath, 0o755);

  const previousPath = process.env.PATH;
  const previousBooted = process.env.AGENT_DEVICE_TEST_EMU_BOOTED_FILE;
  const previousLog = process.env.AGENT_DEVICE_TEST_EMU_LOG_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_EMU_BOOTED_FILE = emulatorBootedPath;
  process.env.AGENT_DEVICE_TEST_EMU_LOG_FILE = emulatorLogPath;

  try {
    await run({ emulatorLogPath, emulatorBootedPath });
  } finally {
    process.env.PATH = previousPath;
    if (previousBooted === undefined) delete process.env.AGENT_DEVICE_TEST_EMU_BOOTED_FILE;
    else process.env.AGENT_DEVICE_TEST_EMU_BOOTED_FILE = previousBooted;
    if (previousLog === undefined) delete process.env.AGENT_DEVICE_TEST_EMU_LOG_FILE;
    else process.env.AGENT_DEVICE_TEST_EMU_LOG_FILE = previousLog;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('ensureAndroidEmulatorBooted launches emulator in headless mode when requested', async () => {
  await withMockedAndroidTools(async ({ emulatorLogPath, emulatorBootedPath }) => {
    const device = await ensureAndroidEmulatorBooted({
      avdName: 'Pixel 9 Pro XL',
      timeoutMs: 5_000,
      headless: true,
    });
    assert.equal(device.platform, 'android');
    assert.equal(device.kind, 'emulator');
    assert.equal(device.id, 'emulator-5554');
    assert.equal(device.booted, true);
    const log = await fs.readFile(emulatorLogPath, 'utf8');
    assert.match(log, /-avd Pixel_9_Pro_XL -no-window -no-audio/);
    await fs.access(emulatorBootedPath);
  });
});

test('ensureAndroidEmulatorBooted reuses running emulator for headless requests', async () => {
  await withMockedAndroidTools(async ({ emulatorLogPath, emulatorBootedPath }) => {
    await fs.writeFile(emulatorBootedPath, 'ready', 'utf8');
    const device = await ensureAndroidEmulatorBooted({
      avdName: 'Pixel_9_Pro_XL',
      timeoutMs: 5_000,
      headless: true,
    });
    assert.equal(device.id, 'emulator-5554');
    const log = await fs.readFile(emulatorLogPath, 'utf8').catch(() => '');
    assert.equal(log.trim(), '');
  });
});

test('ensureAndroidEmulatorBooted launches emulator with GUI by default', async () => {
  await withMockedAndroidTools(async ({ emulatorLogPath }) => {
    const device = await ensureAndroidEmulatorBooted({
      avdName: 'Pixel_9_Pro_XL',
      timeoutMs: 5_000,
    });
    assert.equal(device.id, 'emulator-5554');
    const log = await fs.readFile(emulatorLogPath, 'utf8');
    assert.match(log, /-avd Pixel_9_Pro_XL/);
    assert.doesNotMatch(log, /-no-window/);
  });
});
