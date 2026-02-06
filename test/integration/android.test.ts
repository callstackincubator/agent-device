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

const selector: string[] = [];
const session = ['--session', 'android-test'];

test.after(() => {
  runCliJson(['close', '--platform', 'android', '--json', ...selector, ...session]);
});

test('android settings commands', { skip: shouldSkipAndroid() }, () => {
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

  const snapshot = runCliJson(['snapshot', '-i', '--json', ...selector, ...session]);
  assert.equal(snapshot.status, 0, `${snapshot.stderr}\n${snapshot.stdout}`);
  assert.equal(Array.isArray(snapshot.json?.data?.nodes), true);

  const clickApps = runCliJson(['click', '@e13', '--json', ...selector, ...session]);
  assert.equal(clickApps.status, 0, `${clickApps.stderr}\n${clickApps.stdout}`);
  
  const snapshotApps = runCliJson([
    'snapshot',
    '-i',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(snapshotApps.status, 0, `${snapshotApps.stderr}\n${snapshotApps.stdout}`);
  assert.equal(Array.isArray(snapshotApps.json?.data?.nodes), true);

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
  const devices = listOnlineAndroidSerials();
  if (devices.length === 0) return 'no android devices connected';
  return false;
}

function findAndroidSettingsLabel(): string | null {
  if (hasMultipleAndroidDevices()) return null;
  const serial = listOnlineAndroidSerials()[0];
  const selector = serial ? ['-s', serial] : [];
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
  return listOnlineAndroidSerials().length > 1;
}

function listOnlineAndroidSerials(): string[] {
  const result = runCmdSync('adb', ['devices'], { allowFailure: true });
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map((parts) => parts[0]);
}
