import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { screenshotAndroid } from '../index.ts';
import type { DeviceInfo } from '../../../utils/device.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake-png-body')]);

async function withMockedAdb(
  tempPrefix: string,
  script: string,
  run: (ctx: { device: DeviceInfo; tmpDir: string }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const adbPath = path.join(tmpDir, 'adb');
  await fs.writeFile(adbPath, script, 'utf8');
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await run({ device, tmpDir });
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('screenshotAndroid writes a valid PNG when output is clean', async () => {
  const pngHex = FAKE_PNG.toString('hex');
  const script = `#!/bin/bash\nprintf '\\x${pngHex.match(/.{2}/g)!.join("\\x")}'\n`;

  await withMockedAdb('screenshot-clean-', script, async ({ device, tmpDir }) => {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, FAKE_PNG);
  });
});

test('screenshotAndroid strips warning text before PNG signature', async () => {
  const warning =
    '[Warning] Multiple displays were found, but no display id was specified! Defaulting to the first display found.';
  const warningHex = Buffer.from(warning).toString('hex');
  const pngHex = FAKE_PNG.toString('hex');
  const allHex = warningHex + pngHex;
  const script = `#!/bin/bash\nprintf '\\x${allHex.match(/.{2}/g)!.join("\\x")}'\n`;

  await withMockedAdb('screenshot-warning-', script, async ({ device, tmpDir }) => {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, FAKE_PNG);
  });
});

test('screenshotAndroid throws when output contains no PNG signature', async () => {
  const script = `#!/bin/bash\necho "not a png"\n`;

  await withMockedAdb('screenshot-nopng-', script, async ({ device, tmpDir }) => {
    const outPath = path.join(tmpDir, 'out.png');
    await assert.rejects(() => screenshotAndroid(device, outPath), {
      message: 'Screenshot data does not contain a valid PNG header',
    });
  });
});
