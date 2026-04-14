import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
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
