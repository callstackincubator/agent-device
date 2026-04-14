import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.ts';
import { runCmd, whichCmd } from './exec.ts';
import type { FrameSample } from './transition-summary.ts';

export type ExtractedVideoFrames = {
  frames: FrameSample[];
  durationMs?: number;
  sampleFps: number;
};

type FfprobePayload = {
  format?: {
    duration?: string;
  };
};

const DEFAULT_SAMPLE_FPS = 6;
const DEFAULT_MAX_FRAMES = 80;
const VIDEO_PROBE_TIMEOUT_MS = 10_000;
const VIDEO_EXTRACT_TIMEOUT_MS = 60_000;

export async function extractVideoFrames(params: {
  videoPath: string;
  outputDir: string;
  sampleFps?: number;
  maxFrames?: number;
}): Promise<ExtractedVideoFrames> {
  const [hasFfmpeg, hasFfprobe] = await Promise.all([whichCmd('ffmpeg'), whichCmd('ffprobe')]);
  if (!hasFfmpeg || !hasFfprobe) {
    throw new AppError('TOOL_MISSING', 'diff video requires ffmpeg and ffprobe in PATH', {
      hint: 'Install FFmpeg, then retry diff video.',
    });
  }

  await fs.mkdir(params.outputDir, { recursive: true });
  await removeStaleFrames(params.outputDir);
  const maxFrames = params.maxFrames ?? DEFAULT_MAX_FRAMES;
  const requestedFps = params.sampleFps ?? DEFAULT_SAMPLE_FPS;
  const durationMs = await probeVideoDurationMs(params.videoPath);
  const sampleFps =
    durationMs && durationMs > 0
      ? Math.min(requestedFps, maxFrames / (durationMs / 1_000))
      : requestedFps;
  const pattern = path.join(params.outputDir, 'frame-%06d.png');
  const result = await runCmd(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'info',
      '-i',
      params.videoPath,
      '-vf',
      `fps=${formatFps(sampleFps)},showinfo`,
      '-frames:v',
      String(maxFrames),
      pattern,
    ],
    { allowFailure: true, timeoutMs: VIDEO_EXTRACT_TIMEOUT_MS },
  );
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'ffmpeg failed to extract video frames', {
      stderr: result.stderr,
    });
  }

  const files = (await fs.readdir(params.outputDir))
    .filter((entry) => /^frame-\d+\.png$/i.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const timestamps = parseShowInfoTimestamps(result.stderr);
  return {
    frames: files.map((entry, index) => ({
      index,
      path: path.join(params.outputDir, entry),
      timestampMs: timestamps[index] ?? Math.round((index / sampleFps) * 1_000),
    })),
    ...(durationMs ? { durationMs } : {}),
    sampleFps,
  };
}

async function removeStaleFrames(outputDir: string): Promise<void> {
  const entries = await fs.readdir(outputDir);
  const stale = entries.filter((entry) => /^frame-\d+\.png$/i.test(entry));
  await Promise.all(
    stale.map((entry) =>
      fs.rm(path.join(outputDir, entry), {
        force: true,
      }),
    ),
  );
}

async function probeVideoDurationMs(videoPath: string): Promise<number | undefined> {
  const result = await runCmd(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', videoPath],
    { allowFailure: true, timeoutMs: VIDEO_PROBE_TIMEOUT_MS },
  );
  if (result.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as FfprobePayload;
    const seconds = parsed.format?.duration ? Number(parsed.format.duration) : Number.NaN;
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : undefined;
  } catch {
    return undefined;
  }
}

function parseShowInfoTimestamps(stderr: string): number[] {
  return stderr
    .split(/\r?\n/)
    .map((line) => /pts_time:([0-9.]+)/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Math.round(Number(value) * 1_000))
    .filter((value) => Number.isFinite(value));
}

function formatFps(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
