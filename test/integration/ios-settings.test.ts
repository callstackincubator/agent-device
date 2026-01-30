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

test('ios settings commands', { skip: shouldSkipIos() }, () => {
  const selector = getIosSelectorArgs();
  const session = ['--session', 'ios-test'];
  const caps = getSimctlIoCaps();
  const open = runCliJson([
    'open',
    'com.apple.Preferences',
    '--platform',
    'ios',
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
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assertSupportOrUnsupported(press, caps.tap, 'tap');

  const longPress = runCliJson([
    'long-press',
    '100',
    '200',
    '800',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assertSupportOrUnsupported(longPress, caps.swipe, 'swipe');

  const focus = runCliJson([
    'focus',
    '100',
    '200',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assertSupportOrUnsupported(focus, caps.tap, 'tap');

  const type = runCliJson([
    'type',
    'agent-device',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assertSupportOrUnsupported(type, caps.keyboard, 'keyboard');

  const fill = runCliJson([
    'fill',
    '100',
    '200',
    'agent-device',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assertSupportOrUnsupported(fill, caps.tap && caps.keyboard, 'tap+keyboard');

  const scroll = runCliJson([
    'scroll',
    'down',
    '0.5',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assertSupportOrUnsupported(scroll, caps.swipe, 'swipe');

  const scrollInto = runCliJson([
    'scrollintoview',
    'About',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(scrollInto.status, 1);
  assert.equal(scrollInto.json?.error?.code, 'UNSUPPORTED_OPERATION');

  const outPath = `./test/screenshots/ios-settings.png`;
  const shot = runCliJson([
    'screenshot',
    '--platform',
    'ios',
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
    'com.apple.Preferences',
    '--platform',
    'ios',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(close.status, 0, `${close.stderr}\n${close.stdout}`);
});

function shouldSkipIos(): boolean | string {
  if (process.platform !== 'darwin') return 'iOS tooling only available on macOS';
  if (!hasCommand('xcrun')) return 'xcrun not available';
  const result = runCmdSync('xcrun', ['simctl', 'list', 'devices', '-j'], { allowFailure: true });
  if (result.exitCode !== 0) return 'simctl list failed';
  if (!findPreferredSimulator()) return 'no available iOS simulator';
  return false;
}

function getIosSelectorArgs(): string[] {
  if (process.env.IOS_UDID) return ['--udid', process.env.IOS_UDID];
  if (process.env.IOS_DEVICE) return ['--device', process.env.IOS_DEVICE];
  const preferred = findPreferredSimulator();
  if (preferred?.udid) return ['--udid', preferred.udid];
  if (preferred?.name) return ['--device', preferred.name];
  return [];
}

function getSimctlIoCaps(): { tap: boolean; swipe: boolean; keyboard: boolean } {
  const result = runCmdSync('xcrun', ['simctl', 'io'], { allowFailure: true });
  const output = (result.stderr ?? '') as string;
  const ops = extractIoOperations(output);
  return {
    tap: ops.has('tap'),
    swipe: ops.has('swipe'),
    keyboard: ops.has('keyboard'),
  };
}

function extractIoOperations(text: string): Set<string> {
  const ops = new Set<string>();
  const lines = text.split('\n');
  let inOps = false;
  for (const line of lines) {
    if (line.toLowerCase().includes('supported operations')) {
      inOps = true;
      continue;
    }
    if (!inOps) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('Example:')) break;
    const op = trimmed.split(/\s+/)[0];
    if (op) ops.add(op);
  }
  return ops;
}

function assertSupportOrUnsupported(
  result: { status: number; json?: any; stdout: string; stderr: string },
  supported: boolean,
  op: string,
): void {
  if (supported) {
    assert.equal(result.status, 0, `${op}\n${result.stderr}\n${result.stdout}`);
  } else {
    assert.equal(result.status, 1, `${op}\n${result.stderr}\n${result.stdout}`);
    assert.equal(result.json?.error?.code, 'UNSUPPORTED_OPERATION');
  }
}

function findPreferredSimulator(): { udid?: string; name?: string } | null {
  const result = runCmdSync('xcrun', ['simctl', 'list', 'devices', '-j'], { allowFailure: true });
  if (result.exitCode !== 0) return null;
  try {
    const payload = JSON.parse(result.stdout) as {
      devices: Record<
        string,
        { name: string; udid: string; state: string; isAvailable: boolean }[]
      >;
    };
    const all = Object.values(payload.devices ?? {}).flat();
    const booted = all.find((d) => d.isAvailable && d.state === 'Booted');
    if (booted) return { udid: booted.udid, name: booted.name };
    const named = all.find((d) => d.isAvailable && d.name === 'iPhone 17 Pro');
    if (named) return { udid: named.udid, name: named.name };
  } catch {
    return null;
  }
  return null;
}
