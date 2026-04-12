import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { AppError } from '../utils/errors.ts';
import { decodePng } from './png.ts';
import { annotateDiffRegions } from './screenshot-diff-region-overlay.ts';
import {
  summarizeNonTextDiffDeltas,
  type ScreenshotNonTextDelta,
} from './screenshot-diff-non-text.ts';
import {
  summarizeScreenshotOcr,
  toScreenshotOcrSummary,
  type ScreenshotOcrSummary,
} from './screenshot-diff-ocr.ts';
import { summarizeDiffRegions, type ScreenshotDiffRegion } from './screenshot-diff-regions.ts';

export type ScreenshotDimensionMismatch = {
  expected: { width: number; height: number };
  actual: { width: number; height: number };
};

export type ScreenshotDiffResult = {
  diffPath?: string;
  totalPixels: number;
  differentPixels: number;
  mismatchPercentage: number;
  match: boolean;
  dimensionMismatch?: ScreenshotDimensionMismatch;
  regions?: ScreenshotDiffRegion[];
  currentOverlayPath?: string;
  currentOverlayRefCount?: number;
  ocr?: ScreenshotOcrSummary;
  nonTextDeltas?: ScreenshotNonTextDelta[];
};

export type ScreenshotDiffOptions = {
  threshold?: number;
  outputPath?: string;
  maxRegions?: number;
};

// Each pixel is a point in 3D RGB space (R, G, B each 0–255).
// The maximum possible distance between two colors is from black (0,0,0) to
// white (255,255,255): √(255² + 255² + 255²) = 255√3 ≈ 441.67.
// We use this as the denominator so threshold 0–1 maps linearly to the full
// color distance range: 0 = exact match only, 1 = everything matches.
const COLOR_DISTANCE_SCALE = 255 * Math.sqrt(3);
const DIFF_CONTEXT_LIGHTEN_RATIO = 0.72;
const DIFF_CHANGE_TINT_RATIO = 0.78;
const DIFF_CHANGE_COLOR = { r: 220, g: 0, b: 0 } as const;

export async function compareScreenshots(
  baselinePath: string,
  currentPath: string,
  options: ScreenshotDiffOptions = {},
): Promise<ScreenshotDiffResult> {
  await validateFileExists(baselinePath, 'Baseline image not found');
  await validateFileExists(currentPath, 'Current screenshot not found');

  const diffOutputPath = options.outputPath;

  const [baselineBuffer, currentBuffer] = await Promise.all([
    fs.readFile(baselinePath),
    fs.readFile(currentPath),
  ]);

  const baseline = decodePng(baselineBuffer, 'baseline screenshot');
  const current = decodePng(currentBuffer, 'current screenshot');

  const threshold = options.threshold ?? 0.1;

  // Handle dimension mismatch — no diff image can be generated for different-sized images
  if (baseline.width !== current.width || baseline.height !== current.height) {
    const totalPixels = baseline.width * baseline.height;
    await removeStaleDiffOutput(options.outputPath);
    return {
      match: false,
      mismatchPercentage: 100,
      totalPixels,
      differentPixels: totalPixels,
      dimensionMismatch: {
        expected: { width: baseline.width, height: baseline.height },
        actual: { width: current.width, height: current.height },
      },
    };
  }

  const totalPixels = baseline.width * baseline.height;
  const maxColorDistance = threshold * COLOR_DISTANCE_SCALE;
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const diffMask = new Uint8Array(totalPixels);
  let differentPixels = 0;

  // PNG data is a flat RGBA buffer: [R, G, B, A, R, G, B, A, ...].
  // We step by 4 to visit each pixel and compute its Euclidean distance
  // in RGB space between the baseline and current image.
  for (let index = 0, pixelIndex = 0; index < baseline.data.length; index += 4, pixelIndex += 1) {
    const redDelta = baseline.data[index]! - current.data[index]!;
    const greenDelta = baseline.data[index + 1]! - current.data[index + 1]!;
    const blueDelta = baseline.data[index + 2]! - current.data[index + 2]!;
    const colorDistance = Math.sqrt(redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2);

    if (colorDistance > maxColorDistance) {
      differentPixels += 1;
      diffMask[pixelIndex] = 1;
      const context = renderDiffContextChannel(current, index);
      diff.data[index] = tintChannel(context, DIFF_CHANGE_COLOR.r, DIFF_CHANGE_TINT_RATIO);
      diff.data[index + 1] = tintChannel(context, DIFF_CHANGE_COLOR.g, DIFF_CHANGE_TINT_RATIO);
      diff.data[index + 2] = tintChannel(context, DIFF_CHANGE_COLOR.b, DIFF_CHANGE_TINT_RATIO);
      diff.data[index + 3] = 255;
      continue;
    }

    const context = renderDiffContextChannel(current, index);
    diff.data[index] = context;
    diff.data[index + 1] = context;
    diff.data[index + 2] = context;
    diff.data[index + 3] = 255;
  }

  const regions =
    differentPixels > 0
      ? summarizeDiffRegions({
          diffMask,
          baseline,
          current,
          totalPixels,
          differentPixels,
          maxRegions: options.maxRegions,
        })
      : [];

  if (differentPixels > 0 && diffOutputPath) {
    annotateDiffRegions(diff, regions);
    await fs.mkdir(path.dirname(diffOutputPath), { recursive: true });
    await fs.writeFile(diffOutputPath, PNG.sync.write(diff));
  } else {
    await removeStaleDiffOutput(options.outputPath);
  }

  const ocrAnalysis =
    differentPixels > 0
      ? await summarizeScreenshotOcr({
          baselinePath,
          currentPath,
          width: baseline.width,
          height: baseline.height,
        })
      : undefined;
  const ocr =
    ocrAnalysis && hasScreenshotOcrSummary(ocrAnalysis)
      ? toScreenshotOcrSummary(ocrAnalysis)
      : undefined;
  const nonTextDeltas =
    differentPixels > 0 && ocrAnalysis
      ? summarizeNonTextDiffDeltas({
          diffMask,
          width: baseline.width,
          height: baseline.height,
          regions,
          ocr: ocrAnalysis,
        })
      : [];

  // Round to 2 decimal places: multiply percentage by 100 before rounding,
  // then divide back. e.g. 0.12345 → 12.345% → round(1234.5)/100 → 12.35%
  const mismatchPercentage =
    totalPixels > 0 ? Math.round((differentPixels / totalPixels) * 100 * 100) / 100 : 0;

  return {
    ...(differentPixels > 0 && diffOutputPath ? { diffPath: diffOutputPath } : {}),
    ...(regions.length > 0 ? { regions } : {}),
    ...(ocr ? { ocr } : {}),
    ...(nonTextDeltas.length > 0 ? { nonTextDeltas } : {}),
    totalPixels,
    differentPixels,
    mismatchPercentage,
    match: differentPixels === 0,
  };
}

function hasScreenshotOcrSummary(
  ocr: NonNullable<Awaited<ReturnType<typeof summarizeScreenshotOcr>>>,
): boolean {
  return (
    ocr.matches.length > 0 ||
    (ocr.addedText?.length ?? 0) > 0 ||
    (ocr.removedText?.length ?? 0) > 0 ||
    (ocr.movementClusters?.length ?? 0) > 0
  );
}

async function validateFileExists(filePath: string, errorMessage: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new AppError('INVALID_ARGS', `${errorMessage}: ${filePath}`);
  }
}

async function removeStaleDiffOutput(outputPath: string | undefined): Promise<void> {
  if (!outputPath) return;
  try {
    await fs.unlink(outputPath);
  } catch (error) {
    if (!isFsError(error, 'ENOENT')) throw error;
  }
}

function isFsError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function renderDiffContextChannel(source: PNG, index: number): number {
  const gray = Math.round(
    source.data[index]! * 0.299 + source.data[index + 1]! * 0.587 + source.data[index + 2]! * 0.114,
  );
  return tintChannel(gray, 255, DIFF_CONTEXT_LIGHTEN_RATIO);
}

function tintChannel(base: number, tint: number, ratio: number): number {
  return Math.round(base * (1 - ratio) + tint * ratio);
}
