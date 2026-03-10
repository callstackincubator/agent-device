import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { RecordingGestureEvent } from '../../daemon/types.ts';

function resolveOverlayScriptPath(): string {
  const bundledNeighborPath = fileURLToPath(new URL('./recording-overlay.swift', import.meta.url));
  if (fs.existsSync(bundledNeighborPath)) {
    return bundledNeighborPath;
  }
  return path.resolve(path.dirname(bundledNeighborPath), '../../src/platforms/ios/recording-overlay.swift');
}

const overlayScriptPath = resolveOverlayScriptPath();

export async function overlayRecordingTouches(params: {
  videoPath: string;
  events: RecordingGestureEvent[];
}): Promise<void> {
  const { videoPath, events } = params;
  if (events.length === 0) return;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-record-overlay-'));
  const eventsPath = path.join(tempDir, 'events.json');
  const outputPath = path.join(tempDir, path.basename(videoPath));
  const homePath = path.join(tempDir, 'home');
  const moduleCachePath = path.join(tempDir, 'module-cache');

  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(moduleCachePath, { recursive: true });
  try {
    await runCmd(
      'xcrun',
      ['swift', overlayScriptPath, '--input', videoPath, '--output', outputPath, '--events', eventsPath],
      {
        timeoutMs: 120_000,
        env: {
          ...process.env,
          HOME: homePath,
          CLANG_MODULE_CACHE_PATH: moduleCachePath,
        },
      },
    );
    fs.copyFileSync(outputPath, videoPath);
  } catch (error) {
    const cause =
      error instanceof AppError
        ? error
        : new AppError('COMMAND_FAILED', String(error), undefined, error instanceof Error ? error : undefined);
    throw new AppError(
      'COMMAND_FAILED',
      'Failed to add touch overlays to the iOS recording',
      {
        videoPath,
        script: overlayScriptPath,
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
