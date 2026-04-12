import { PNG } from 'pngjs';
import type { MutableDiffRegion } from './screenshot-diff-regions.ts';

const MIN_SPLIT_REGION_HEIGHT = 180;
const MIN_SPLIT_REGION_WIDTH_RATIO = 0.35;
const MIN_SPLIT_SEGMENT_HEIGHT = 80;
const LOW_DENSITY_RATIO = 0.08;
const MIN_LOW_DENSITY_BAND_HEIGHT = 6;
const ROW_SMOOTHING_RADIUS = 3;

export function splitLargeDiffRegions(
  regions: MutableDiffRegion[],
  params: { diffMask: Uint8Array; baseline: PNG; current: PNG },
): MutableDiffRegion[] {
  return regions.flatMap((region) =>
    shouldSplitRegion(region, params.baseline.width)
      ? splitRegionByHorizontalDensity(region, params)
      : [region],
  );
}

function shouldSplitRegion(region: MutableDiffRegion, imageWidth: number): boolean {
  const width = region.maxX - region.minX + 1;
  const height = region.maxY - region.minY + 1;
  return height >= MIN_SPLIT_REGION_HEIGHT && width >= imageWidth * MIN_SPLIT_REGION_WIDTH_RATIO;
}

function splitRegionByHorizontalDensity(
  region: MutableDiffRegion,
  params: { diffMask: Uint8Array; baseline: PNG; current: PNG },
): MutableDiffRegion[] {
  const rowCounts = measureRowDiffCounts(region, params.diffMask, params.baseline.width);
  const smoothed = smoothCounts(rowCounts);
  const lowDensityBands = findLowDensityBands(
    smoothed,
    Math.max(1, Math.round((region.maxX - region.minX + 1) * LOW_DENSITY_RATIO)),
  );
  const ranges = buildSegmentRanges(region, lowDensityBands);
  if (ranges.length <= 1) return [region];

  const splitRegions = ranges
    .map(([minY, maxY]) => buildRegionSlice(region, minY, maxY, params))
    .filter((slice): slice is MutableDiffRegion => slice !== null);
  return splitRegions.length > 1 ? splitRegions : [region];
}

function measureRowDiffCounts(
  region: MutableDiffRegion,
  diffMask: Uint8Array,
  imageWidth: number,
): number[] {
  const counts: number[] = [];
  for (let y = region.minY; y <= region.maxY; y += 1) {
    let count = 0;
    for (let x = region.minX; x <= region.maxX; x += 1) {
      if (diffMask[y * imageWidth + x] === 1) count += 1;
    }
    counts.push(count);
  }
  return counts;
}

function smoothCounts(counts: number[]): number[] {
  return counts.map((_, index) => {
    let sum = 0;
    let samples = 0;
    const start = Math.max(0, index - ROW_SMOOTHING_RADIUS);
    const end = Math.min(counts.length - 1, index + ROW_SMOOTHING_RADIUS);
    for (let sample = start; sample <= end; sample += 1) {
      sum += counts[sample]!;
      samples += 1;
    }
    return Math.round(sum / samples);
  });
}

function findLowDensityBands(counts: number[], threshold: number): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  let start: number | null = null;
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index]! <= threshold) {
      start ??= index;
      continue;
    }
    if (start !== null) {
      if (index - start >= MIN_LOW_DENSITY_BAND_HEIGHT) bands.push([start, index - 1]);
      start = null;
    }
  }
  if (start !== null && counts.length - start >= MIN_LOW_DENSITY_BAND_HEIGHT) {
    bands.push([start, counts.length - 1]);
  }
  return bands;
}

function buildSegmentRanges(
  region: MutableDiffRegion,
  lowDensityBands: Array<[number, number]>,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let segmentStart = region.minY;
  for (const [relativeStart, relativeEnd] of lowDensityBands) {
    const cutY = region.minY + Math.round((relativeStart + relativeEnd) / 2);
    if (
      cutY - segmentStart + 1 < MIN_SPLIT_SEGMENT_HEIGHT ||
      region.maxY - cutY < MIN_SPLIT_SEGMENT_HEIGHT
    ) {
      continue;
    }
    ranges.push([segmentStart, cutY]);
    segmentStart = cutY + 1;
  }
  ranges.push([segmentStart, region.maxY]);
  return ranges;
}

function buildRegionSlice(
  region: MutableDiffRegion,
  minY: number,
  maxY: number,
  params: { diffMask: Uint8Array; baseline: PNG; current: PNG },
): MutableDiffRegion | null {
  let slice: MutableDiffRegion | null = null;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = region.minX; x <= region.maxX; x += 1) {
      const pixelIndex = y * params.baseline.width + x;
      if (params.diffMask[pixelIndex] !== 1) continue;
      slice ??= createEmptyRegion(x, y);
      addPixelToSlice(slice, pixelIndex, x, y, params.baseline, params.current);
    }
  }
  return slice;
}

function createEmptyRegion(x: number, y: number): MutableDiffRegion {
  return {
    minX: x,
    minY: y,
    maxX: x,
    maxY: y,
    differentPixels: 0,
    baselineRed: 0,
    baselineGreen: 0,
    baselineBlue: 0,
    currentRed: 0,
    currentGreen: 0,
    currentBlue: 0,
  };
}

function addPixelToSlice(
  slice: MutableDiffRegion,
  pixelIndex: number,
  x: number,
  y: number,
  baseline: PNG,
  current: PNG,
): void {
  const dataIndex = pixelIndex * 4;
  slice.minX = Math.min(slice.minX, x);
  slice.minY = Math.min(slice.minY, y);
  slice.maxX = Math.max(slice.maxX, x);
  slice.maxY = Math.max(slice.maxY, y);
  slice.differentPixels += 1;
  slice.baselineRed += baseline.data[dataIndex]!;
  slice.baselineGreen += baseline.data[dataIndex + 1]!;
  slice.baselineBlue += baseline.data[dataIndex + 2]!;
  slice.currentRed += current.data[dataIndex]!;
  slice.currentGreen += current.data[dataIndex + 1]!;
  slice.currentBlue += current.data[dataIndex + 2]!;
}
