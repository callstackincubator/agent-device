import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { AppError } from '../utils/errors.ts';
import { decodePng } from './png.ts';

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
};

export type ScreenshotDiffOptions = {
  threshold?: number;
  outputPath?: string;
};

// Each pixel is a point in 3D RGB space (R, G, B each 0–255).
// The maximum possible distance between two colors is from black (0,0,0) to
// white (255,255,255): √(255² + 255² + 255²) = 255√3 ≈ 441.67.
// We use this as the denominator so threshold 0–1 maps linearly to the full
// color distance range: 0 = exact match only, 1 = everything matches.
const COLOR_DISTANCE_SCALE = 255 * Math.sqrt(3);

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
  let differentPixels = 0;

  // PNG data is a flat RGBA buffer: [R, G, B, A, R, G, B, A, ...].
  // We step by 4 to visit each pixel and compute its Euclidean distance
  // in RGB space between the baseline and current image.
  for (let index = 0; index < baseline.data.length; index += 4) {
    const redDelta = baseline.data[index]! - current.data[index]!;
    const greenDelta = baseline.data[index + 1]! - current.data[index + 1]!;
    const blueDelta = baseline.data[index + 2]! - current.data[index + 2]!;
    const colorDistance = Math.sqrt(redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2);

    if (colorDistance > maxColorDistance) {
      differentPixels += 1;
      // Red highlight for different pixels
      diff.data[index] = 255;
      diff.data[index + 1] = 0;
      diff.data[index + 2] = 0;
      diff.data[index + 3] = 255;
      continue;
    }

    // Unchanged pixels are converted to a dimmed grayscale (30% brightness).
    // This makes the diff image look like a faded version of the original with
    // red pixels popping out where differences exist.
    const gray = Math.round(
      (baseline.data[index]! + baseline.data[index + 1]! + baseline.data[index + 2]!) / 3,
    );
    const dimmed = Math.round(gray * 0.3);
    diff.data[index] = dimmed;
    diff.data[index + 1] = dimmed;
    diff.data[index + 2] = dimmed;
    diff.data[index + 3] = 255;
  }

  if (differentPixels > 0 && diffOutputPath) {
    await fs.mkdir(path.dirname(diffOutputPath), { recursive: true });
    await fs.writeFile(diffOutputPath, PNG.sync.write(diff));
  } else {
    await removeStaleDiffOutput(options.outputPath);
  }

  // Round to 2 decimal places: multiply percentage by 100 before rounding,
  // then divide back. e.g. 0.12345 → 12.345% → round(1234.5)/100 → 12.35%
  const mismatchPercentage =
    totalPixels > 0 ? Math.round((differentPixels / totalPixels) * 100 * 100) / 100 : 0;

  return {
    ...(differentPixels > 0 && diffOutputPath ? { diffPath: diffOutputPath } : {}),
    totalPixels,
    differentPixels,
    mismatchPercentage,
    match: differentPixels === 0,
  };
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
