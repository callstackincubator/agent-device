import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isPlayableVideo } from '../video.ts';

function makeAtom(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

test('isPlayableVideo falls back to MP4 container validation when swift is unavailable', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-video-fallback-'));
  const videoPath = path.join(tmpDir, 'sample.mp4');
  await fs.writeFile(videoPath, Buffer.concat([makeAtom('ftyp'), makeAtom('moov')]));

  const previousPath = process.env.PATH;
  process.env.PATH = '';

  try {
    assert.equal(await isPlayableVideo(videoPath), true);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('isPlayableVideo fallback rejects files without playable MP4 atoms', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-video-invalid-'));
  const videoPath = path.join(tmpDir, 'sample.mp4');
  await fs.writeFile(videoPath, Buffer.concat([makeAtom('ftyp'), makeAtom('mdat')]));

  const previousPath = process.env.PATH;
  process.env.PATH = '';

  try {
    assert.equal(await isPlayableVideo(videoPath), false);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
