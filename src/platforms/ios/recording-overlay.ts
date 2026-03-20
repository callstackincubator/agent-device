import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import { waitForPlayableVideo, waitForStableFile } from '../../utils/video.ts';
import type { RecordingGestureEvent } from '../../daemon/types.ts';

function resolveScriptPath(scriptName: string): string {
  const bundledNeighborPath = fileURLToPath(new URL(`./${scriptName}`, import.meta.url));
  if (fs.existsSync(bundledNeighborPath)) {
    return bundledNeighborPath;
  }
  return path.resolve(path.dirname(bundledNeighborPath), `../../src/platforms/ios/${scriptName}`);
}

const overlayScriptPath = resolveScriptPath('recording-overlay.swift');
const trimScriptPath = resolveScriptPath('recording-trim.swift');

async function exportProcessedVideo(params: {
  videoPath: string;
  scriptPath: string;
  scriptArgs: string[];
  commandDescription: string;
}): Promise<void> {
  const { videoPath, scriptPath, scriptArgs, commandDescription } = params;
  await waitForStableFile(videoPath);
  await waitForPlayableVideo(videoPath);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-record-overlay-'));
  const inputPath = path.join(tempDir, `input${path.extname(videoPath) || '.mp4'}`);
  const outputPath = path.join(tempDir, path.basename(videoPath));
  const homePath = path.join(tempDir, 'home');
  const moduleCachePath = path.join(tempDir, 'module-cache');

  fs.copyFileSync(videoPath, inputPath);
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(moduleCachePath, { recursive: true });
  try {
    await runCmd(
      'xcrun',
      ['swift', scriptPath, '--input', inputPath, '--output', outputPath, ...scriptArgs],
      {
        timeoutMs: 120_000,
        env: {
          ...process.env,
          HOME: homePath,
          CLANG_MODULE_CACHE_PATH: moduleCachePath,
        },
      },
    );
    await waitForPlayableVideo(outputPath);
    fs.copyFileSync(outputPath, videoPath);
  } catch (error) {
    const cause =
      error instanceof AppError
        ? error
        : new AppError(
            'COMMAND_FAILED',
            String(error),
            undefined,
            error instanceof Error ? error : undefined,
          );
    throw new AppError(
      'COMMAND_FAILED',
      commandDescription,
      {
        videoPath,
        script: scriptPath,
        stderr: cause.details?.stderr,
        stdout: cause.details?.stdout,
        exitCode: cause.details?.exitCode,
        processExitError: cause.details?.processExitError,
      },
      cause,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function trimRecordingStart(params: {
  videoPath: string;
  trimStartMs: number;
}): Promise<void> {
  const { videoPath, trimStartMs } = params;
  if (!(trimStartMs > 0)) return;

  await exportProcessedVideo({
    videoPath,
    scriptPath: trimScriptPath,
    scriptArgs: ['--trim-start-ms', String(trimStartMs)],
    commandDescription: 'Failed to trim the start of the iOS recording',
  });
}

export async function overlayRecordingTouches(params: {
  videoPath: string;
  events: RecordingGestureEvent[];
  targetLabel?: string;
}): Promise<void> {
  const { videoPath, events, targetLabel = 'recording' } = params;
  if (events.length === 0) return;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-record-events-'));
  const eventsPath = path.join(tempDir, 'events.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  try {
    await exportProcessedVideo({
      videoPath,
      scriptPath: overlayScriptPath,
      scriptArgs: ['--events', eventsPath],
      commandDescription: `Failed to add touch overlays to the ${targetLabel}`,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
