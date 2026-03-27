import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn() };
});
vi.mock('../adb.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adb.ts')>();
  return { ...actual, sleep: vi.fn() };
});

import { screenshotAndroid } from '../screenshot.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { runCmd } from '../../../utils/exec.ts';
import { sleep } from '../adb.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b9xkAAAAASUVORK5CYII=',
  'base64',
);
const mockRunCmd = vi.mocked(runCmd);
const mockSleep = vi.mocked(sleep);

const device: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

beforeEach(() => {
  mockRunCmd.mockReset();
  mockSleep.mockReset();
  mockSleep.mockResolvedValue(undefined);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: VALID_PNG };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });
});

test('screenshotAndroid waits for transient UI to settle before capture', async () => {
  const events: string[] = [];
  const outPath = path.join(os.tmpdir(), `agent-device-android-screenshot-${Date.now()}.png`);

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      events.push('capture');
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: VALID_PNG };
    }
    events.push(args.some((arg) => arg.includes('exit')) ? 'disable' : 'enable');
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  mockSleep.mockImplementation(async (ms) => {
    events.push(`settle:${ms}`);
  });

  await screenshotAndroid(device, outPath);

  assert.deepEqual(events, ['enable', 'enable', 'enable', 'settle:1000', 'capture', 'disable']);
});

test('screenshotAndroid writes a valid PNG when output is clean', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-clean-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, VALID_PNG);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid strips warning text before PNG signature', async () => {
  const warning =
    '[Warning] Multiple displays were found, but no display id was specified! Defaulting to the first display found.';
  const payload = Buffer.concat([Buffer.from(warning), VALID_PNG]);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: payload };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-warning-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, VALID_PNG);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid strips trailing garbage after PNG payload', async () => {
  const payload = Buffer.concat([VALID_PNG, Buffer.from('\ntrailing-warning\n')]);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: payload };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-trailing-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, VALID_PNG);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid throws when output contains no PNG signature', async () => {
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: Buffer.from('not a png') };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-nopng-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await assert.rejects(() => screenshotAndroid(device, outPath), {
      message: 'Screenshot data does not contain a valid PNG header',
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid throws when PNG payload is truncated', async () => {
  const payload = VALID_PNG.subarray(0, VALID_PNG.length - 3);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: payload };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-truncated-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await assert.rejects(() => screenshotAndroid(device, outPath), {
      message: 'Screenshot data does not contain a complete PNG payload',
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
