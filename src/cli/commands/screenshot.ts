import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatScreenshotDiffText,
  formatSnapshotDiffText,
  formatTransitionSummaryText,
} from '../../utils/output.ts';
import { AppError } from '../../utils/errors.ts';
import { compareScreenshots, type ScreenshotDiffResult } from '../../utils/screenshot-diff.ts';
import { attachCurrentOverlayMatches } from '../../utils/screenshot-diff-overlay-matches.ts';
import { resolveUserPath } from '../../utils/path-resolution.ts';
import { collectFrameInputs, summarizeFrameTransitions } from '../../utils/transition-summary.ts';
import { extractVideoFrames } from '../../utils/video-frames.ts';
import { buildSelectionOptions, writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const screenshotCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = await client.capture.screenshot({
    path: positionals[0] ?? flags.out,
    overlayRefs: flags.overlayRefs,
    ...(flags.screenshotFullscreen !== undefined ? { fullscreen: flags.screenshotFullscreen } : {}),
  });
  const data = {
    path: result.path,
    ...(result.overlayRefs ? { overlayRefs: result.overlayRefs } : {}),
  };
  writeCommandOutput(flags, data, () =>
    result.overlayRefs
      ? `Annotated ${result.overlayRefs.length} refs onto ${result.path}`
      : result.path,
  );
  return true;
};

export const diffCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  if (positionals[0] === 'snapshot') {
    const result = await client.capture.diff({
      ...buildSelectionOptions(flags),
      kind: 'snapshot',
      out: flags.out,
      interactiveOnly: flags.snapshotInteractiveOnly,
      compact: flags.snapshotCompact,
      depth: flags.snapshotDepth,
      scope: flags.snapshotScope,
      raw: flags.snapshotRaw,
    });
    writeCommandOutput(flags, result, () => formatSnapshotDiffText(result));
    return true;
  }

  if (positionals[0] === 'frames') {
    rejectUnsupportedDiffFlags(
      flags,
      ['baseline', 'overlayRefs', 'sampleFps', 'maxFrames'],
      'diff frames',
    );
    const outputDir = resolveTransitionOutputDir(flags.out);
    const frames = await collectFrameInputs(positionals.slice(1), {
      frameIntervalMs: flags.frameIntervalMs,
    });
    const result = await summarizeFrameTransitions({
      frames,
      input: {
        kind: 'frames',
        frameCount: frames.length,
        sampledFrameCount: frames.length,
        ...(flags.telemetry ? { telemetryPath: resolveUserPath(flags.telemetry) } : {}),
      },
      options: {
        threshold: readDiffThreshold(flags.threshold),
        outputDir,
        ...(flags.telemetry ? { telemetryPath: flags.telemetry } : {}),
      },
    });
    writeCommandOutput(flags, result, () => formatTransitionSummaryText(result));
    return true;
  }

  if (positionals[0] === 'video') {
    rejectUnsupportedDiffFlags(flags, ['baseline', 'frameIntervalMs', 'overlayRefs'], 'diff video');
    const videoRaw = positionals[1];
    if (!videoRaw || positionals.length > 2) {
      throw new AppError('INVALID_ARGS', 'diff video requires exactly one video path');
    }
    const videoPath = resolveUserPath(videoRaw);
    const outputDir = resolveTransitionOutputDir(flags.out);
    const framesDir = path.join(outputDir, 'frames');
    const extracted = await extractVideoFrames({
      videoPath,
      outputDir: framesDir,
      sampleFps: flags.sampleFps,
      maxFrames: flags.maxFrames,
    });
    const result = await summarizeFrameTransitions({
      frames: extracted.frames,
      input: {
        kind: 'video',
        path: videoPath,
        frameCount: extracted.frames.length,
        sampledFrameCount: extracted.frames.length,
        sampleFps: extracted.sampleFps,
        ...(extracted.durationMs ? { durationMs: extracted.durationMs } : {}),
        ...(flags.telemetry ? { telemetryPath: resolveUserPath(flags.telemetry) } : {}),
      },
      options: {
        threshold: readDiffThreshold(flags.threshold),
        outputDir,
        ...(flags.telemetry ? { telemetryPath: flags.telemetry } : {}),
      },
    });
    writeCommandOutput(flags, result, () => formatTransitionSummaryText(result));
    return true;
  }

  if (positionals[0] !== 'screenshot') return false;
  rejectUnsupportedDiffFlags(
    flags,
    ['sampleFps', 'maxFrames', 'frameIntervalMs', 'telemetry'],
    'diff screenshot',
  );

  const baselineRaw = flags.baseline;
  if (!baselineRaw || typeof baselineRaw !== 'string') {
    throw new AppError('INVALID_ARGS', 'diff screenshot requires --baseline <path>');
  }

  const baselinePath = resolveUserPath(baselineRaw);
  const outputPath = typeof flags.out === 'string' ? resolveUserPath(flags.out) : undefined;
  const currentRaw = positionals[1];
  if (positionals.length > 2) {
    throw new AppError(
      'INVALID_ARGS',
      'diff screenshot accepts at most one current screenshot path',
    );
  }

  const thresholdNum = readDiffThreshold(flags.threshold);

  if (currentRaw) {
    if (flags.overlayRefs) {
      throw new AppError(
        'INVALID_ARGS',
        'diff screenshot <current.png> cannot use --overlay-refs because saved-image comparisons have no live accessibility refs',
      );
    }
    const result = await compareScreenshots(baselinePath, resolveUserPath(currentRaw), {
      threshold: thresholdNum,
      outputPath,
    });
    writeCommandOutput(flags, result, () => formatScreenshotDiffText(result));
    return true;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-diff-current-'));
  const tmpScreenshotPath = path.join(tmpDir, `current-${Date.now()}.png`);
  const screenshotResult = await client.capture.screenshot({ path: tmpScreenshotPath });
  const currentPath = screenshotResult.path;

  let result: ScreenshotDiffResult;
  try {
    result = await compareScreenshots(baselinePath, currentPath, {
      threshold: thresholdNum,
      outputPath,
    });
    if (flags.overlayRefs && !result.match && !result.dimensionMismatch) {
      const overlayResult = await client.capture.screenshot({
        path: outputPath ? deriveCurrentOverlayPath(outputPath) : undefined,
        overlayRefs: true,
      });
      result = {
        ...result,
        currentOverlayPath: overlayResult.path,
        ...(overlayResult.overlayRefs
          ? { currentOverlayRefCount: overlayResult.overlayRefs.length }
          : {}),
        ...(result.regions && overlayResult.overlayRefs
          ? {
              regions: attachCurrentOverlayMatches(result.regions, overlayResult.overlayRefs),
            }
          : {}),
      };
    } else if (flags.overlayRefs && outputPath) {
      removeStaleCurrentOverlay(outputPath);
    }
  } finally {
    try {
      fs.unlinkSync(currentPath);
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  writeCommandOutput(flags, result, () => formatScreenshotDiffText(result));
  return true;
};

function deriveCurrentOverlayPath(outputPath: string): string {
  const extension = path.extname(outputPath);
  const base = extension ? outputPath.slice(0, -extension.length) : outputPath;
  return `${base}.current-overlay${extension || '.png'}`;
}

function removeStaleCurrentOverlay(outputPath: string): void {
  try {
    fs.unlinkSync(deriveCurrentOverlayPath(outputPath));
  } catch (error) {
    if (!isFsError(error, 'ENOENT')) throw error;
  }
}

function isFsError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function readDiffThreshold(rawThreshold: unknown): number {
  if (rawThreshold == null || rawThreshold === '') return 0.1;
  const threshold = Number(rawThreshold);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new AppError('INVALID_ARGS', '--threshold must be a number between 0 and 1');
  }
  return threshold;
}

function resolveTransitionOutputDir(rawOut: unknown): string {
  const outputDir =
    typeof rawOut === 'string'
      ? resolveUserPath(rawOut)
      : fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-transition-diff-'));
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function rejectUnsupportedDiffFlags(
  flags: Record<string, unknown>,
  flagKeys: string[],
  commandLabel: string,
): void {
  const unsupported = flagKeys.filter((key) => flags[key] !== undefined);
  if (unsupported.length === 0) return;
  throw new AppError(
    'INVALID_ARGS',
    `${commandLabel} does not support ${unsupported.map((key) => `--${toKebabCase(key)}`).join(', ')}`,
  );
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
