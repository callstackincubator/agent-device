import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatScreenshotDiffText, formatSnapshotDiffText } from '../../utils/output.ts';
import { AppError } from '../../utils/errors.ts';
import { compareScreenshots, type ScreenshotDiffResult } from '../../utils/screenshot-diff.ts';
import { attachCurrentOverlayMatches } from '../../utils/screenshot-diff-overlay-matches.ts';
import { resolveUserPath } from '../../utils/path-resolution.ts';
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

  if (positionals[0] !== 'screenshot') return false;

  const baselineRaw = flags.baseline;
  if (!baselineRaw || typeof baselineRaw !== 'string') {
    throw new AppError('INVALID_ARGS', 'diff screenshot requires --baseline <path>');
  }

  const baselinePath = resolveUserPath(baselineRaw);
  const outputPath = typeof flags.out === 'string' ? resolveUserPath(flags.out) : undefined;

  let thresholdNum = 0.1;
  if (flags.threshold != null && flags.threshold !== '') {
    thresholdNum = Number(flags.threshold);
    if (Number.isNaN(thresholdNum) || thresholdNum < 0 || thresholdNum > 1) {
      throw new AppError('INVALID_ARGS', '--threshold must be a number between 0 and 1');
    }
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
        ...(overlayResult.overlayRefs ? { currentOverlayRefs: overlayResult.overlayRefs } : {}),
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
