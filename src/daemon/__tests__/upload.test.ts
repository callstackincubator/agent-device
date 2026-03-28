import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { receiveUpload } from '../artifact-download.ts';
import { runCmdSync } from '../../utils/exec.ts';

function makeUploadRequest(body: Buffer, headers: Record<string, string>): IncomingMessage {
  return Object.assign(Readable.from(body), { headers }) as IncomingMessage;
}

test('receiveUpload rejects uploads that exceed the configured content-length limit', async () => {
  const req = makeUploadRequest(Buffer.alloc(0), {
    'x-artifact-type': 'file',
    'x-artifact-filename': 'Sample.apk',
    'content-length': String(2 * 1024 * 1024 * 1024 + 1),
  });

  await assert.rejects(async () => await receiveUpload(req), /Upload exceeds maximum size/i);
});

test('receiveUpload rejects app bundle archives containing symlinks', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-upload-archive-'));
  const appDir = path.join(tempRoot, 'Sample.app');
  const targetFile = path.join(tempRoot, 'payload.txt');
  const archivePath = path.join(tempRoot, 'Sample.tar');

  try {
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(targetFile, 'payload');
    fs.symlinkSync('../payload.txt', path.join(appDir, 'linked.txt'));
    runCmdSync('tar', ['cf', archivePath, '-C', tempRoot, 'Sample.app']);

    const req = makeUploadRequest(fs.readFileSync(archivePath), {
      'x-artifact-type': 'app-bundle',
      'x-artifact-filename': 'Sample.app',
      'content-length': String(fs.statSync(archivePath).size),
    });

    await assert.rejects(
      async () => await receiveUpload(req),
      /cannot contain symlinks or hard links/i,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
