import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatScreenshotDiffText, printJson } from '../../utils/output.ts';
import { AppError } from '../../utils/errors.ts';
import { compareScreenshots, type ScreenshotDiffResult } from '../../utils/screenshot-diff.ts';
import { resolveUserPath } from '../../utils/path-resolution.ts';
import type { ClientCommandHandler } from './router.ts';

export const screenshotCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = await client.capture.screenshot({
    path: positionals[0] ?? flags.out,
    overlayRefs: flags.overlayRefs,
  });
  const data = {
    path: result.path,
    ...(result.overlayRefs ? { overlayRefs: result.overlayRefs } : {}),
  };
  if (flags.json) printJson({ success: true, data });
  else if (result.overlayRefs) {
    process.stdout.write(`Annotated ${result.overlayRefs.length} refs onto ${result.path}\n`);
  } else {
    process.stdout.write(`${result.path}\n`);
  }
  return true;
};

export const diffCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
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
  } finally {
    try {
      fs.unlinkSync(currentPath);
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  if (flags.json) {
    printJson({ success: true, data: result });
  } else {
    process.stdout.write(formatScreenshotDiffText(result));
  }
  return true;
};
