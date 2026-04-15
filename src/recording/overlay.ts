import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCmd } from '../utils/exec.ts';
import { AppError } from '../utils/errors.ts';
import { waitForPlayableVideo, waitForStableFile } from '../utils/video.ts';

function resolveScriptPath(scriptName: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptCandidates = [
    fileURLToPath(new URL(`./${scriptName}`, import.meta.url)),
    path.resolve(moduleDir, `../../ios-runner/AgentDeviceRunner/RecordingScripts/${scriptName}`),
    path.resolve(moduleDir, `../../../ios-runner/AgentDeviceRunner/RecordingScripts/${scriptName}`),
    path.resolve(process.cwd(), `ios-runner/AgentDeviceRunner/RecordingScripts/${scriptName}`),
  ];

  for (const candidate of scriptCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new AppError('COMMAND_FAILED', `Missing recording helper script: ${scriptName}`, {
    hint: 'Ensure ios-runner/AgentDeviceRunner/RecordingScripts is present in this checkout or bundled with the package.',
    scriptName,
    searchedPaths: scriptCandidates,
  });
}

let overlayScriptPath: string | undefined;
let trimScriptPath: string | undefined;
let resizeScriptPath: string | undefined;

export function getRecordingOverlaySupportWarning(
  hostPlatform: NodeJS.Platform = process.platform,
): string | undefined {
  if (hostPlatform === 'darwin') {
    return undefined;
  }
  return 'touch overlay burn-in is only available on macOS hosts; returning raw video plus gesture telemetry';
}

function getOverlayScriptPath(): string {
  overlayScriptPath ??= resolveScriptPath('recording-overlay.swift');
  return overlayScriptPath;
}

function getTrimScriptPath(): string {
  trimScriptPath ??= resolveScriptPath('recording-trim.swift');
  return trimScriptPath;
}

function getResizeScriptPath(): string {
  resizeScriptPath ??= resolveScriptPath('recording-resize.swift');
  return resizeScriptPath;
}

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
    scriptPath: getTrimScriptPath(),
    scriptArgs: ['--trim-start-ms', String(trimStartMs)],
    commandDescription: 'Failed to trim the start of the iOS recording',
  });
}

export async function overlayRecordingTouches(params: {
  videoPath: string;
  telemetryPath: string;
  targetLabel?: string;
}): Promise<void> {
  const { videoPath, telemetryPath, targetLabel = 'recording' } = params;
  await exportProcessedVideo({
    videoPath,
    scriptPath: getOverlayScriptPath(),
    scriptArgs: ['--events', telemetryPath],
    commandDescription: `Failed to add touch overlays to the ${targetLabel}`,
  });
}

export async function resizeRecording(params: {
  videoPath: string;
  quality: number;
  targetLabel?: string;
}): Promise<void> {
  const { videoPath, quality, targetLabel = 'recording' } = params;
  await exportProcessedVideo({
    videoPath,
    scriptPath: getResizeScriptPath(),
    scriptArgs: ['--quality', String(quality)],
    commandDescription: `Failed to resize the ${targetLabel}`,
  });
}
