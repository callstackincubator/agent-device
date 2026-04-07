import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCmd, whichCmd } from '../exec.ts';

test('runCmd enforces timeoutMs and rejects with COMMAND_FAILED', async () => {
  await assert.rejects(
    runCmd(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 100 }),
    (error: unknown) => {
      const err = error as { code?: string; message?: string; details?: Record<string, unknown> };
      return (
        err?.code === 'COMMAND_FAILED' &&
        typeof err?.message === 'string' &&
        err.message.includes('timed out') &&
        err.details?.timeoutMs === 100
      );
    },
  );
});

test('whichCmd resolves absolute executable paths without invoking a shell', async () => {
  assert.equal(await whichCmd(process.execPath), true);
});

test('whichCmd resolves bare commands from PATH', async () => {
  assert.equal(await whichCmd('node'), true);
});

test('whichCmd rejects suspicious command strings', async () => {
  assert.equal(await whichCmd('node; rm -rf /'), false);
  assert.equal(await whichCmd('./node'), false);
});

test.sequential('whichCmd ignores directories that match a command name in PATH', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-whichcmd-'));
  const fakeCommandDir = path.join(root, 'fake-tool');
  fs.mkdirSync(fakeCommandDir);

  const previousPath = process.env.PATH;
  process.env.PATH = `${root}${path.delimiter}${previousPath ?? ''}`;

  try {
    assert.equal(await whichCmd('fake-tool'), false);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
