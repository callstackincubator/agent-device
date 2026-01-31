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

  const snapshot = runCliJson([
    'snapshot',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(snapshot.status, 0, `${snapshot.stderr}\n${snapshot.stdout}`);
  assert.equal(Array.isArray(snapshot.json?.data?.nodes), true);

  const click = runCliJson([
    'click',
    '@e3',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(click.status, 0, `${click.stderr}\n${click.stdout}`);

  const snapshotGeneral = runCliJson([
    'snapshot',
    '--json',
    ...selector,
    ...session,
  ]);
  assert.equal(snapshotGeneral.status, 0, `${snapshotGeneral.stderr}\n${snapshotGeneral.stdout}`);
  assert.equal(snapshotGeneral.json?.data?.nodes[1].type, 'AXHeading');
  assert.equal(snapshotGeneral.json?.data?.nodes[1].label, 'General');

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
