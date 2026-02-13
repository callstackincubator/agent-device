import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAndroidApp, parseAndroidLaunchComponent, swipeAndroid } from '../index.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';
import { findBounds, parseUiHierarchy } from '../ui-hierarchy.ts';

test('parseUiHierarchy reads double-quoted Android node attributes', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text="Hello" content-desc="Greeting" resource-id="com.demo:id/title" bounds="[10,20][110,60]" clickable="true" enabled="true"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
  assert.deepEqual(result.nodes[0].rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(result.nodes[0].hittable, true);
  assert.equal(result.nodes[0].enabled, true);
});

test('parseUiHierarchy reads single-quoted Android node attributes', () => {
  const xml =
    "<hierarchy><node class='android.widget.TextView' text='Hello' content-desc='Greeting' resource-id='com.demo:id/title' bounds='[10,20][110,60]' clickable='true' enabled='true'/></hierarchy>";

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
  assert.deepEqual(result.nodes[0].rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(result.nodes[0].hittable, true);
  assert.equal(result.nodes[0].enabled, true);
});

test('parseUiHierarchy supports mixed quote styles in one node', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text=\'Hello\' content-desc="Greeting" resource-id=\'com.demo:id/title\' bounds="[10,20][110,60]"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
});

test('findBounds supports single and double quoted attributes', () => {
  const xml = [
    '<hierarchy>',
    '<node text="Nothing" content-desc="Irrelevant" bounds="[0,0][10,10]"/>',
    "<node text='Target from single quote' content-desc='Alt single' bounds='[100,200][300,500]'/>",
    '<node text="Target from double quote" content-desc="Alt double" bounds="[50,50][150,250]"/>',
    '</hierarchy>',
  ].join('');

  assert.deepEqual(findBounds(xml, 'single quote'), { x: 200, y: 350 });
  assert.deepEqual(findBounds(xml, 'alt double'), { x: 100, y: 150 });
});

test('parseUiHierarchy ignores attribute-name prefix spoofing', () => {
  const xml =
    "<hierarchy><node class='android.widget.TextView' hint-text='Spoofed' text='Actual' bounds='[10,20][110,60]'/></hierarchy>";

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Actual');
});

test('findBounds ignores bounds-like fragments inside other attribute values', () => {
  const xml = [
    '<hierarchy>',
    "<node text='Target' content-desc=\"metadata bounds='[900,900][1000,1000]'\" bounds='[100,200][300,500]'/>",
    '</hierarchy>',
  ].join('');

  assert.deepEqual(findBounds(xml, 'target'), { x: 200, y: 350 });
});

test('parseAndroidLaunchComponent extracts final resolved component', () => {
  const stdout = [
    'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
    'com.boatsgroup.boattrader/com.boatsgroup.boattrader.MainActivity',
  ].join('\n');
  assert.equal(
    parseAndroidLaunchComponent(stdout),
    'com.boatsgroup.boattrader/com.boatsgroup.boattrader.MainActivity',
  );
});

test('parseAndroidLaunchComponent returns null when no component is present', () => {
  const stdout = 'No activity found';
  assert.equal(parseAndroidLaunchComponent(stdout), null);
});

test('openAndroidApp rejects activity override for deep link URLs', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  await assert.rejects(
    () => openAndroidApp(device, '  https://example.com/path  ', '.MainActivity'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      return true;
    },
  );
});

test('swipeAndroid invokes adb input swipe with duration', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-swipe-test-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await swipeAndroid(device, 10, 20, 30, 40, 250);
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, ['-s', 'emulator-5554', 'shell', 'input', 'swipe', '10', '20', '30', '40', '250']);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
