import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractVideoFrames } from '../video-frames.ts';
import { runCmd, whichCmd } from '../exec.ts';
import { AppError } from '../errors.ts';

vi.mock('../exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../exec.ts')>();
  return { ...actual, runCmd: vi.fn(), whichCmd: vi.fn() };
});

const mockRunCmd = vi.mocked(runCmd);
const mockWhichCmd = vi.mocked(whichCmd);

beforeEach(() => {
  mockRunCmd.mockReset();
  mockWhichCmd.mockReset();
});

test('extractVideoFrames reports a TOOL_MISSING error when ffmpeg tooling is absent', async () => {
  mockWhichCmd.mockResolvedValue(false);

  await assert.rejects(
    () => extractVideoFrames({ videoPath: '/tmp/session.mp4', outputDir: '/tmp/frames' }),
    (error) =>
      error instanceof AppError &&
      error.code === 'TOOL_MISSING' &&
      error.message === 'diff video requires ffmpeg and ffprobe in PATH' &&
      error.details?.hint === 'Install FFmpeg, then retry diff video.',
  );
  assert.equal(mockRunCmd.mock.calls.length, 0);
});

test('extractVideoFrames clears stale frame PNGs before reading extracted frames', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-video-frames-'));
  const stalePath = path.join(outputDir, 'frame-000002.png');
  fs.writeFileSync(stalePath, Buffer.from('stale'));

  mockWhichCmd.mockResolvedValue(true);
  mockRunCmd.mockImplementation(async () => {
    const freshPath = path.join(outputDir, 'frame-000001.png');
    fs.writeFileSync(freshPath, Buffer.from('fresh'));
    return { stdout: '', stderr: 'pts_time:0.100', exitCode: 0 };
  });

  const result = await extractVideoFrames({
    videoPath: '/tmp/session.mp4',
    outputDir,
    sampleFps: 2,
    maxFrames: 2,
  });

  assert.equal(result.frames.length, 1);
  assert.equal(fs.existsSync(stalePath), false);
});
