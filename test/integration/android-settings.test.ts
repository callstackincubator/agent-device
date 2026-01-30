import test from 'node:test';
import assert from 'node:assert/strict';
import { runCmdSync, whichCmdSync } from '../../src/utils/exec.ts';
import { existsSync } from 'node:fs';

function hasCommand(cmd: string): boolean {
  return whichCmdSync(cmd);
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = runCmdSync(
    process.execPath,
    ['--experimental-strip-types', 'src/bin.ts', ...args],
    { allowFailure: true },
  );
  return { status: result.exitCode, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runCliJson(args: string[]): {
  status: number;
  json?: any;
  stdout: string;
  stderr: string;
} {
  const result = runCli(args);
  let json: any;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

test('android settings commands', { skip: shouldSkipAndroid() }, () => {
  const selector = getAndroidSelectorArgs();
  const session = ['--session', 'android-test'];
  const open = runCliJson([
    'open',
    'Settings',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(open.status, 0, `${open.stderr}\n${open.stdout}`);

  const press = runCliJson([
    'press',
    '100',
    '200',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(press.status, 0, `${press.stderr}\n${press.stdout}`);

  const longPress = runCliJson([
    'long-press',
    '100',
    '200',
    '800',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(longPress.status, 0, `${longPress.stderr}\n${longPress.stdout}`);

  const focus = runCliJson([
    'focus',
    '100',
    '200',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(focus.status, 0, `${focus.stderr}\n${focus.stdout}`);

  const type = runCliJson([
    'type',
    'agent-device',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(type.status, 0, `${type.stderr}\n${type.stdout}`);

  const fill = runCliJson([
    'fill',
    '100',
    '200',
    'agent-device',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(fill.status, 0, `${fill.stderr}\n${fill.stdout}`);

  const scroll = runCliJson([
    'scroll',
    'down',
    '0.5',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(scroll.status, 0, `${scroll.stderr}\n${scroll.stdout}`);

  const scrollTarget = findAndroidSettingsLabel();
  if (scrollTarget) {
    const scrollInto = runCliJson([
      'scrollintoview',
      scrollTarget,
      '--platform',
      'android',
      '--json',
      ...selector,
      ...session,
    ]);
    if (scrollInto.status === 0) {
      assert.equal(scrollInto.status, 0, `${scrollInto.stderr}\n${scrollInto.stdout}`);
    } else {
      assert.equal(
        scrollInto.json?.error?.code,
        'UNSUPPORTED_OPERATION',
        `${scrollInto.stderr}\n${scrollInto.stdout}`,
      );
    }
  }

  const outPath = `./test/screenshots/android-settings.png`;
  const shot = runCliJson([
    'screenshot',
    '--platform',
    'android',
    '--json',
    '--out',
    outPath,
    ...selector,
    ...session,
  ]);
  assert.equal(shot.status, 0, `${shot.stderr}\n${shot.stdout}`);
  assert.equal(existsSync(outPath), true);

  const close = runCliJson([
    'close',
    'com.android.settings',
    '--platform',
    'android',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(close.status, 0, `${close.stderr}\n${close.stdout}`);
});

function shouldSkipAndroid(): boolean | string {
  if (!hasCommand('adb')) return 'adb not available';
  const result = runCmdSync('adb', ['devices'], { allowFailure: true });
  if (result.exitCode !== 0) return 'adb devices failed';
  const devices = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'));
  if (devices.length === 0) return 'no android devices connected';
  return false;
}

function getAndroidSelectorArgs(): string[] {
  if (process.env.ANDROID_SERIAL) return ['--serial', process.env.ANDROID_SERIAL];
  if (process.env.ANDROID_DEVICE) return ['--device', process.env.ANDROID_DEVICE];
  return [];
}

function findAndroidSettingsLabel(): string | null {
  const hasSerial = Boolean(process.env.ANDROID_SERIAL);
  if (!hasSerial && hasMultipleAndroidDevices()) return null;
  const selector = hasSerial ? ['-s', process.env.ANDROID_SERIAL as string] : [];
  const dump = runCmdSync(
    'adb',
    [...selector, 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml'],
    { allowFailure: true },
  );
  if (dump.exitCode !== 0) return null;
  const xml = runCmdSync('adb', [...selector, 'shell', 'cat', '/sdcard/window_dump.xml'], {
    allowFailure: true,
  });
  if (xml.exitCode !== 0) return null;
  const content = xml.stdout ?? '';
  const candidates = ['About phone', 'System', 'Network & internet', 'Display', 'Battery'];
  for (const label of candidates) {
    if (content.includes(label)) return label;
  }
  return null;
}

function hasMultipleAndroidDevices(): boolean {
  const result = runCmdSync('adb', ['devices'], { allowFailure: true });
  if (result.exitCode !== 0) return true;
  const devices = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'));
  return devices.length > 1;
}
